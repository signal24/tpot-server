const crypto = require('crypto');
const logGenerator = require('debug');
const URL = require('url').URL;

const { HttpError } = require('./Errors');
const Tunnel = require('./Tunnel');
const TunnelStore = require('./TunnelStore');

const ACCEPTABLE_CLOCK_DRIFT_MS = 60000;

class TunnelBuilder {
    constructor() {
        this.log = logGenerator('tunnel-builder');
        this.tunnelStore = TunnelStore.instance;
    }

    setServer(server) {
        this.server = server;
    }

    async handleCreateRequest(httpConnection, initialData) {
        this.log('building tunnel for connection ' + httpConnection.id);

        this.verifyAuthorization(httpConnection);

        const url = new URL(httpConnection.requestMeta.url, 'http://x/');
        let subdomain = url.searchParams.get('subdomain');
        if (subdomain) {
            subdomain = subdomain.toLowerCase();
            this.validateSubdomain(subdomain);
        } else {
            subdomain = this.generateSubdomain();
        }

        this.tunnelStore.tunnels[subdomain] = {
            cxn: httpConnection,
            socket: httpConnection.socket
        };

        httpConnection.socket.on('close', () => {
            delete this.tunnelStore.tunnels[subdomain];
        });

        const fakeRequest = {
            headers: httpConnection.requestHeaders,
            httpVersion: httpConnection.requestMeta.httpVersion,
            method: httpConnection.requestMeta.method,
            socket: httpConnection.socket,
            url: httpConnection.requestMeta.url
        };

        let tunnel;

        // this currently doesn't actually do anything async, so the return of this function indicates its done and the CB has been executed
        this.server.wss.handleUpgrade(fakeRequest, httpConnection.socket, initialData, ws => {
            this.tunnelStore.tunnels[subdomain].ws = ws;
            
            tunnel = new Tunnel(ws, subdomain);
            this.tunnelStore.tunnels[subdomain].tunnel = tunnel;

            this.log('created tunnel ' + tunnel.id + ' for connection ' + httpConnection.id + ' with subdomain: ' + subdomain);
        });

        return tunnel;
    }

    verifyAuthorization(httpConnection) {
        if (!this.server.options.authKey) return true;

        const authHeader = httpConnection.requestHeaders.authorization;
        if (!authHeader)
            throw new HttpError(401, 'Unauthorized', 'no authorization header present');
        if (authHeader.substr(0, 7) != 'TPoT-1 ')
            throw new HttpError(401, 'Unauthorized', 'incorrect authorization protocol');

        const encodedAuthIn = authHeader.substr(7);
        const decodedAuthIn = Buffer.from(encodedAuthIn, 'base64').toString('utf8');
        const matches = decodedAuthIn.match(/^(.+)\n([0-9]+)\n(.+)$/);
        if (!matches)
            throw new HttpError(401, 'Unauthorized', 'invalid authorization string');

        const now = Date.now();
        const requestTs = parseInt(matches[2]);
        if (requestTs < now - ACCEPTABLE_CLOCK_DRIFT_MS)
            throw new HttpError(401, 'Unauthorized', 'authorization too far in the past');
        if (requestTs > now + ACCEPTABLE_CLOCK_DRIFT_MS)
            throw new HttpError(401, 'Unauthorized', 'authorization too far in the future');

        return new Promise((resolve, reject) => {
            const saltString = matches[1] + '\n' + matches[2];
            const salt = crypto.createHash('md5').update(saltString).digest().toString('hex');
            
            crypto.pbkdf2(this.server.options.authKey, salt, 32768, 128, 'sha256', (err, buffer) => {
                if (err) return reject(err);
                const token = buffer.toString('base64');
                const isMatch = token === matches[3];
                isMatch || request.log('computed token does not match');
                resolve(isMatch);
            });
        });
    }

    validateSubdomain(subdomain) {
        if (!/^[a-z0-9-]{1,24}$/.test(subdomain) || subdomain.charAt(0) == '-')
            throw new HttpError(400, 'Bad Request', 'requested subdomain is invalid');
        
        if (this.tunnelStore.tunnels[subdomain])
            throw new HttpError(409, 'Conflict', 'subdomain is already in use');
    }

    generateSubdomain() {
        let subdomain;
        
        do {
            subdomain = Math.random().toString(36).substr(2, 8);
        }
        while (this.tunnelStore.tunnels[subdomain]);

        return subdomain;
    }
}

TunnelBuilder.instance = new TunnelBuilder;

module.exports = TunnelBuilder;