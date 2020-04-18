const net = require('net');
const debug = require('debug');
const WebSocket = require('ws');

const HttpConnection = require('./ClientHttpConnection');
const TunnelBuilder = require('./TunnelBuilder');

class Server {
    options = {};
    cxnCount = 0;

    configure(options) {
        Object.assign(this.options, options);
    }

    init() {
        this.options.domainSuffix = '.' + this.options.domain;

        this.log = debug('server');

        this.wss = new WebSocket.Server({ noServer: true });

        this.netServer = net.createServer();
        this.netServer.on('error', this.handleServerError.bind(this));
        this.netServer.on('listening', this.handleServerListening.bind(this));
        this.netServer.on('connection', this.handleServerConnection.bind(this));
        this.netServer.listen(this.options.port || 3000, '0.0.0.0');

        TunnelBuilder.instance.setServer(this);
    }

    /******************
     * MAIN SOCKET
     *****************/

    handleServerError(err) {
        this.log('server error', err);
        process.exit(-1);
    }
    
    handleServerListening() {
        const address = this.netServer.address();
        this.log('server listening on http://' + address.address + ':' + address.port);
    }

    handleServerConnection(socket) {
        const cxnId = ++this.cxnCount;
        new HttpConnection(this, socket, cxnId);
    }
}

module.exports = Server;