/**
 * Extracts request data from a Request object into the format that
 * Sentry expects
 *
 * @param {Request} req - The request object
 * @returns {Sentry.PolymorphicRequest}
 */
export function getRequestData(req: Request) {
    return {
        url: req.url,
        method: req.method,
        headers: Object.fromEntries(req.headers.entries()),
    };
}
