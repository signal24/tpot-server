const EventEmitter = require('events').EventEmitter;

const TunnelBuilder = require('./TunnelBuilder');
const TunnelStore = require('./TunnelStore');
const { HttpError, TunnelError } = require('./Errors');

const HEADER_LIMIT = 8192;

class ClientHttpConnection extends EventEmitter {
    constructor(server, socket, id) {
        super();

        this.server = server;
        this.socket = socket;
        this.id = id;

        this.log = this.server.log.extend('http-cxn-' + this.id);
        this.log('http connection from ' + this.socket.remoteAddress + ':' + this.socket.remotePort);

        this.initialDataLen = 0;
        this.initialData = [];
        this.requestMetaTerminalOffset = null;
        this.requestMeta = null;
        this.requestHeadersTerminalOffset = null;
        this.requestHeaders = null;

        this.isEstablished = false;
        
        this.socket.on('error', this.handleSocketError.bind(this));
        this.socket.on('close', this.handleSocketClosed.bind(this));
        this.socket.once('data', this.handleSocketInitialData.bind(this));
    }

    handleSocketError(err) {
        this.log('socket encountered error:', err);
        this.socket.destroy();
    }

    handleSocketClosed(hadError) {
        if (hadError) return this.log('socket closed with error');
        if (!this.isEstablished) return this.log('socket closed before establishing any meaningful connection');
        this.log('socket closed');
    }

    async handleSocketInitialData(data) {
        this.appendInitialData(data);

        try {
            this.extractInitialData(data);
            this.verifyHeaderLength();
            
            if (!this.requestHeadersTerminalOffset)
                return this.socket.once('data', this.handleSocketInitialData.bind(this));
    
            await this.processInitialData();
        }

        catch (err) {
            if (err instanceof HttpError) return this.handleHttpError(err);
            if (err instanceof TunnelError) return this.handleTunnelError(err);
            throw err;
        }
    }

    appendInitialData(data) {
        this.initialData.push(data);
        this.initialDataLen += data.length;
    }

    extractInitialData(latestData) {
        if (!this.requestMetaTerminalOffset) {
            const firstCrLfIndex = latestData.indexOf('\r\n');
            if (firstCrLfIndex < 0) return;
            
            this.requestMetaTerminalOffset = this.initialDataLen - latestData.length + firstCrLfIndex;
            const requestLine = Buffer.concat(this.initialData).slice(0, this.requestMetaTerminalOffset).toString('utf8');
            const requestLineComponents = requestLine.match(/^([A-Z]+) ([^ ]+) HTTP\/(1\.[01])$/);
            if (!requestLineComponents) throw new HttpError(400, 'Bad Request');
            
            this.requestMeta = {
                method: requestLineComponents[1],
                url: requestLineComponents[2],
                httpVersion: requestLineComponents[3]
            };
        }

        const headerEndIndex = latestData.indexOf('\r\n\r\n');
        if (headerEndIndex < 0) return;
        
        this.requestHeadersTerminalOffset = this.initialDataLen - latestData.length + headerEndIndex;
    }

    verifyHeaderLength() {
        const headerLen = this.requestMetaTerminalOffset || this.initialDataLen;
        if (headerLen > HEADER_LIMIT)
            throw new HttpError(413, 'Request Entity Too Large', 'headers exceeded maximum allowed length');
    }

    async processInitialData() {
        this.initialData = Buffer.concat(this.initialData);

        const headersData = this.initialData.slice(this.requestMetaTerminalOffset + 2, this.requestHeadersTerminalOffset);
        const headersString = headersData.toString('utf8');

        let headers = {};
        this.requestHeaders = headers;

        headersString.split(/\r\n/g).forEach(line => {
            const colonOffset = line.indexOf(': ');
            if (colonOffset < 0) throw new HttpError(400, 'Bad Request', 'invalid header');
            const key = line.substr(0, colonOffset).toLowerCase();
            const value = line.substr(colonOffset + 2);

            if (headers[key])
                headers[key] += '\n' + value;
            else
                headers[key] = value;
        });

        if (!headers.host) throw new HttpError(400, 'Bad Request', 'missing host header');

        const httpHost = headers.host.replace(/:.*$/, '').toLowerCase();
        this.log('request:', headers.host, this.requestMeta.method, this.requestMeta.url);

        if (httpHost === this.server.options.domain)
            return await this.handleDirectRequest();
        
        if (httpHost.substr(-this.server.options.domainSuffix.length) === this.server.options.domainSuffix) {
            const subdomain = httpHost.substr(0, httpHost.length - this.server.options.domainSuffix.length);
            return this.handleSubdomainRequest(subdomain);
        }
        
        throw new HttpError(404, 'Not Found');
    }

    async handleDirectRequest() {
        if (!/^\/create-tpot($|\?)/.test(this.requestMeta.url))
            throw new HttpError(404, 'Not Found');
        if (this.requestMeta.method != 'GET')
            throw new HttpError(405, 'Method Not Allowed');
        if (this.requestMeta.httpVersion != '1.1')
            throw new HttpError(400, 'Bad Request', 'incorrect http version');
        if (this.requestHeaders.connection.toLowerCase() != 'upgrade')
            throw new HttpError(400, 'Bad Request', 'incorrect connection header');
        if (this.requestHeaders.upgrade.toLowerCase() != 'websocket')
            throw new HttpError(400, 'Bad Request', 'incorrect upgrade header');
        
        const bodyData = this.initialData.slice(this.requestHeadersTerminalOffset + 4);
        const tunnel = await TunnelBuilder.instance.handleCreateRequest(this, bodyData);

        if (!tunnel) return;

        this.isEstablished = true;
    }

    handleSubdomainRequest(subdomain) {
        const entity = TunnelStore.instance.tunnels[subdomain];
        
        if (!entity) throw new HttpError(503, 'tunnel not found');
        if (!entity.tunnel) throw new HttpError(503, 'tunnel not ready');

        // const bodyData = this.initialData.slice(this.requestHeadersTerminalOffset + 4);
        entity.tunnel.handleNewConnection(this, this.initialData);

        this.isEstablished = true;
    }

    handleHttpError({ statusCode, message, extendedMessage }) {
        extendedMessage = extendedMessage ? `${message} (${extendedMessage})` : message;
        this.log('ERR: ' + statusCode + ' ' + extendedMessage);
        this.socket.write('HTTP/1.1 ' + statusCode + ' ' + message + '\r\nContent-Type: text/plain\r\nContent-Length: ' + extendedMessage.length + '\r\n\r\n' + extendedMessage);
        this.socket.end();
    }

    handleTunnelError({ message }) {
        this.handleHttpError({
            statusCode: 503,
            message
        });
    }
}

module.exports = ClientHttpConnection;