require('dotenv').config();

if (!process.env.DOMAIN)
    throw new Error('DOMAIN must be configured');
if (process.env.AUTH_KEY && process.env.AUTH_KEY.length < 32)
    throw new Error('AUTH_KEY, if provided, must be at least 32 characters');

const debug = require('debug');
debug.enable('*');

const Server = require('./lib/Server');
const server = new Server();

server.configure({
    domain: process.env.DOMAIN,
    authKey: process.env.AUTH_KEY
});

server.init();