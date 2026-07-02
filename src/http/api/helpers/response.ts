function jsonResponse(message: string, status: number, code?: string) {
    const body = message
        ? JSON.stringify({ message, ...(code ? { code } : {}) })
        : null;

    return new Response(body, {
        headers: {
            'Content-Type': 'application/json',
        },
        status,
    });
}

export const ok = (body: unknown) =>
    new Response(JSON.stringify(body), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });

export const BadRequest = (message: string, code?: string) =>
    jsonResponse(message, 400, code);
export const Forbidden = (message: string, code?: string) =>
    jsonResponse(message, 403, code);
export const NotFound = (message: string, code?: string) =>
    jsonResponse(message, 404, code);
export const Conflict = (message: string, code?: string) =>
    jsonResponse(message, 409, code);
export const UnprocessableEntity = (message: string, code?: string) =>
    jsonResponse(message, 422, code);
export const InternalServerError = (message: string, code?: string) =>
    jsonResponse(message, 500, code);
