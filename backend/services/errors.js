/**
 * An error a service raises when the caller is at fault rather than the code.
 *
 * Controllers in this project answer with res.status(4xx).json({ message }) and
 * fall back to 500 on anything unexpected. Moving business logic into a service
 * would otherwise lose that distinction — every rejected transition would
 * surface as a 500. Carrying the status on the error keeps controllers to a
 * few lines and keeps a bad request looking like a bad request.
 */
export class ServiceError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ServiceError';
        this.status = status;
    }
}

export const badRequest = (message) => new ServiceError(message, 400);
export const forbidden = (message = 'You do not have permission to do that') => new ServiceError(message, 403);
export const notFound = (message = 'Not found') => new ServiceError(message, 404);
export const conflict = (message) => new ServiceError(message, 409);

/**
 * The one place a service error becomes an HTTP response.
 *
 * Anything that is not a ServiceError is a bug rather than a caller mistake,
 * so it keeps the existing 500-with-message behaviour and is logged.
 */
export const sendError = (res, e) => {
    if (e instanceof ServiceError) {
        return res.status(e.status).json({ message: e.message });
    }
    /**
     * A malformed id in the URL is the caller getting it wrong, not the server
     * falling over. Mongoose raises a CastError for it, which would otherwise
     * surface as a 500 and read as an outage.
     */
    if (e?.name === 'CastError') {
        return res.status(404).json({ message: 'Not found' });
    }
    console.error(e);
    return res.status(500).json({ message: e.message });
};
