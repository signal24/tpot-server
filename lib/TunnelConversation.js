const EventEmitter = require('events').EventEmitter;

// const ClientHttpConnection = require('./ClientHttpConnection');
const { TunnelError } = require('./Errors');

const CONTROL_CODES = require('./TunnelControlCodes');

class TunnelConversation extends EventEmitter {
    constructor(tunnel, id) {
        super();

        this.tunnel = tunnel;
        this.id = id;
        this.mode = null;

        this.isTunnelConvoOpen = true;
        this.isClientConnected = true;
        this.hasEnded = false;
        this.bytesForwardedThroughTunnel = 0;
        this.bytesForwardedToClient = 0;

        this.log = this.tunnel.log.extend('convo-' + this.id);
    }


    /******************
     * CLIENT HANDLERS
     *****************/

    handleNewConnection(clientConnection, initialData) {
        if (this.connection)
            throw new Error('connection has already been established');
        
        this.client = clientConnection;
        this.clientSocket = this.client.socket;

        this.clientSocket.on('close', this.handleClientSocketClosed.bind(this));
        this.clientSocket.on('error', this.handleClientSocketError.bind(this));
        this.clientSocket.on('data', this.handleClientSocketDataReceived.bind(this));
        this.clientSocket.on('drain', this.handleClientSocketWriteDrained.bind(this));

        // TODO: figure out how to make this work later. having a cyclic dependency issue.
        // if (clientConnection instanceof ClientHttpConnection) {
            this.mode = CONTROL_CODES.TYPE_HTTP;
        // else if (...)
        //     this.mode = CONTROL_CODES.TYPE_RAW;
        // else
        //     throw new Error('unhandled connection type');

        const remoteAddr = this.clientSocket.remoteAddress.replace(/^.*:/, '').split('.');
        const remotePort = this.clientSocket.remotePort;

        const controlBuffer = Buffer.allocUnsafe(10);
        controlBuffer.writeUInt8(CONTROL_CODES.MSG_CONTROL, 0);
        controlBuffer.writeUInt8(this.mode, 1);
        controlBuffer.writeUInt16LE(this.id, 2);
        controlBuffer.writeUInt8(remoteAddr[0], 4);
        controlBuffer.writeUInt8(remoteAddr[1], 5);
        controlBuffer.writeUInt8(remoteAddr[2], 6);
        controlBuffer.writeUInt8(remoteAddr[3], 7);
        controlBuffer.writeUInt16LE(remotePort, 8);
        this.tunnel.ws.send(controlBuffer);

        this.forwardDataThroughTunnel(initialData);
    }

    handleClientSocketDataReceived(data) {
        this.forwardDataThroughTunnel(data);
    }

    handleClientSocketWriteDrained() {
        this.sendTunnelControlMessage(CONTROL_CODES.CONVO_RESUME);
    }


    /******************
     * TUNNEL HANDLERS
     *****************/

    handleDataFromTunnel(data) {
        if (data[0] == CONTROL_CODES.CONVO_DATA)
            return this.forwardToClient(data.slice(1));
        if (data[0] == CONTROL_CODES.CONVO_PAUSE)
            return this.invokeClientSocketMethod('pause');
        if (data[0] == CONTROL_CODES.CONVO_RESUME)
            return this.invokeClientSocketMethod('resume');
        if (data[0] == CONTROL_CODES.CONVO_CLOSED)
            return this.handleUpstreamSocketClosed();
        if (data[0] == CONTROL_CODES.CONVO_NOCONNECT)
            return this.handleUpstreamSocketCouldNotConnect();
        
        throw new TunnelError('unhandled conversation control code');
    }
    

    /******************
     * OUTPUT FUNCTIONS
     *****************/

    sendTunnelControlMessage(controlCode) {
        if (!this.isTunnelConvoOpen) return false;

        const outBuffer = Buffer.allocUnsafe(4);
        outBuffer.writeUInt8(CONTROL_CODES.MSG_CONVO, 0);
        outBuffer.writeUInt16LE(this.id, 1);
        outBuffer.writeUInt8(controlCode, 3);
        this.tunnel.ws.send(outBuffer);
    }

    forwardDataThroughTunnel(data) {
        if (!this.isTunnelConvoOpen) return false;
        
        const outBuffer = Buffer.allocUnsafe(4 + data.length);
        outBuffer.writeUInt8(CONTROL_CODES.MSG_CONVO, 0);
        outBuffer.writeUInt16LE(this.id, 1);
        outBuffer.writeUInt8(CONTROL_CODES.CONVO_DATA, 3);
        data.copy(outBuffer, 4);
        this.tunnel.ws.send(outBuffer);
        
        this.bytesForwardedThroughTunnel += data.length;
    }

    forwardToClient(data) {
        if (!this.isClientConnected) return false;

        const shouldContinueWriting = this.clientSocket.write(data);
        if (!shouldContinueWriting) this.sendTunnelControlMessage(CONTROL_CODES.CONVO_PAUSE);

        this.bytesForwardedToClient += data.length;
    }

    invokeClientSocketMethod(method) {
        if (!this.isClientConnected) return;
        this.clientSocket[method]();
    }


    /******************
     * TEARDOWN
     *****************/

    handleClientSocketClosed() {
        this.isClientConnected = false;
        this.sendTunnelControlMessage(CONTROL_CODES.CONVO_CLOSED);
        this.checkForEnd();
    }

    handleClientSocketError(err) {
        this.handleClientSocketClosed();
    }

    handleUpstreamSocketClosed() {
        this.isTunnelConvoOpen = false;
        this.isClientConnected && this.clientSocket.end();
        this.checkForEnd();
    }

    handleUpstreamSocketCouldNotConnect() {
        if (this.isClientConnected) {
            if (this.mode == CONTROL_CODES.TYPE_HTTP) {
                this.client.handleHttpError({
                    statusCode: 503,
                    message: 'tunnel could not connect to upstream'
                });
            }

            this.clientSocket.end();
        }
    }

    terminate() {
        this.isTunnelConvoOpen = false;

        if (this.isClientConnected) {
            if (this.mode == CONTROL_CODES.TYPE_HTTP && this.bytesForwardedToClient == 0) {
                this.client.handleHttpError({
                    statusCode: 503,
                    message: 'tunnel disconnected suddenly'
                });
            } else {
                this.clientSocket.end();
            }
        }

        this.checkForEnd();
    }

    checkForEnd() {
        if (this.isTunnelConvoOpen) return;
        if (this.isClientConnected) return;
        if (this.hasEnded) return;
        this.hasEnded = true;
        this.emit('end');

        this.log('transmitted %d bytes upstream, %d bytes downstream', this.bytesForwardedThroughTunnel, this.bytesForwardedToClient);
    }
}

module.exports = TunnelConversation;