function jsonResponse(message: string, status: number) {
    const body = message ? JSON.stringify({ message }) : null;

    return new Response(body, {
        headers: {
            'Content-Type': 'application/json',
        },
        status,
    });
}

export const BadRequest = (message: string) => jsonResponse(message, 400);
export const Forbidden = (message: string) => jsonResponse(message, 403);
export const NotFound = (message: string) => jsonResponse(message, 404);
export const Conflict = (message: string) => jsonResponse(message, 409);
export const InternalServerError = (message: string) =>
    jsonResponse(message, 500);
