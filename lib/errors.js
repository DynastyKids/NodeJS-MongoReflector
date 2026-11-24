class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

const badRequest = message => new HttpError(400, message);
const forbidden = message => new HttpError(403, message);

// Hide credentials if a connection string ever ends up in an error message.
function redact(text) {
    return String(text).replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1***@');
}

// Driver errors caused by bad client input rather than a server failure.
const CLIENT_ERROR_NAMES = new Set([
    'MongoParseError',
    'MongoInvalidArgumentError',
    'MongoAPIError',
    'BSONError',
    'BSONVersionError'
]);

function statusFor(err) {
    if (err instanceof HttpError) return err.status;
    // body-parser errors (invalid JSON, body too large)
    if (err && err.type && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return err.status;
    if (err && CLIENT_ERROR_NAMES.has(err.name)) return 400;
    return 500;
}

module.exports = { HttpError, badRequest, forbidden, redact, statusFor };
