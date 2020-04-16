class HttpError extends Error {
    constructor(statusCode, message, extendedMessage) {
        super(message);

        this.statusCode = statusCode;
        this.extendedMessage = extendedMessage;
    }
}

class TunnelError extends Error {}

module.exports = {
    HttpError,
    TunnelError
};