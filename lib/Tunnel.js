const logGenerator = require('debug');

const Conversation = require('./TunnelConversation');
const { TunnelError } = require('./Errors');

const CONTROL_CODES = require('./TunnelControlCodes');

let tunnelCount = 0;

class Tunnel {
    conversations = {};
    openConversationCount = 0;
    nextConversationId = 0;

    constructor(ws, host) {
        this.id = ++tunnelCount;
        this.ws = ws;
        this.host = host;

        this.log = logGenerator('tunnel-' + this.id);

        this.ws.on('error', this.handleWsError.bind(this));
        this.ws.on('close', this.handleWsClosed.bind(this));
        this.ws.on('message', this.handleWsMessage.bind(this));
        this.ws.on('ping', this.handleWsPing.bind(this));

        this.lastPingTs = 0;
        this.checkInterval = setTimeout(this.verifyPingTs.bind(this), 30000);

        this.sendGreeting();
    }


    /******************
     * WEBSOCKET HANDLERS
     *****************/

    handleWsError(err) {
        this.log('WebSocket error:', err);
    }

    handleWsClosed(code, reason) {
        clearInterval(this.checkInterval);
        Object.values(this.conversations).forEach(conversation => conversation.terminate());
        this.log('WebSocket disconnected', code, reason);
    }

    handleWsPing() {
        this.lastPingTs = Date.now();
    }

    handleWsMessage(data) {
        try {
            if (data[0] == CONTROL_CODES.MSG_CONTROL)
                return this.handleControlMessage(data.slice(1));
            if (data[0] == CONTROL_CODES.MSG_CONVO)
                return this.handleConversationMessage(data.slice(1));
        }
        
        catch (err) {
            if (err instanceof TunnelError) {
                this.log('ERR: ' + err.message);
                return this.ws.close(4180, err.message);
            }

            else {
                throw err;
            }
        }
        
        this.ws.close(4180, 'unhandled message type');
    }


    /******************
     * SETUP & PERSISTENCE
     *****************/

    verifyPingTs() {
        if (this.lastPingTs + 30000 < Date.now()) {
            this.log('no ping received in a while. terminating.');
            this.ws.terminate();
        }
    }

    sendGreeting() {
        let greetingBuffer = Buffer.alloc(9 + this.host.length);
        greetingBuffer.writeUInt8(CONTROL_CODES.MSG_CONTROL, 0);
        greetingBuffer.writeUInt8(CONTROL_CODES.CONTROL_GREETINGS, 1);
        greetingBuffer.write('TPOT/1 ' + this.host, 2);
        this.ws.send(greetingBuffer);
    }


    /******************
     * NEW CONNECTION HANDLING
     *****************/

    handleNewConnection(clientConnection, initialData) {
        const conversationId = this.generateConversationId();
        
        const conversation = new Conversation(this, conversationId);
        this.conversations[conversationId] = conversation;

        this.openConversationCount++;
        this.log('created conversation ' + conversationId + ' for connection ' + clientConnection.id + ', now have ' + this.openConversationCount + ' open conversations');

        conversation.once('end', () => {
            this.openConversationCount--;
            delete this.conversations[conversationId];
            this.log('conversation ' + conversationId + ' ended, leaving ' + this.openConversationCount + ' open conversations');
        });
        
        conversation.handleNewConnection(clientConnection, initialData);
    }
    
    generateConversationId() {
        if (this.openConversationCount == 65535) {
            throw new TunnelError('reached maximum connections');
        }

        let conversationId;
        do {
            conversationId = ++this.nextConversationId;
            
            if (conversationId == 65536) {
                this.nextConversationId = conversationId = 1;
            }
        }
        while (this.conversations[conversationId]);

        return conversationId;
    }


    /******************
     * INBOUND DATA PROCESSING
     *****************/

    handleControlMessage(data) {
        // none implemented yet
        throw new TunnelError('invalid control message');
    }

    handleConversationMessage(data) {
        const conversationId = data.readUInt16LE(0);
        const conversation = this.conversations[conversationId];
        
        if (!conversation) {
            // throw new TunnelError('conversation ' + conversationId + ' does not exist');
            // just ignore these for now
            return this.log('received conversation message ' + String.fromCharCode(data[2]) + ' for non-existent conversation ' + conversationId);
        }
        
        conversation.handleDataFromTunnel(data.slice(2));
    }
}

module.exports = Tunnel;