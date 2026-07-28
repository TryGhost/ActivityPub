type FetchHandler = (request: Request) => Response | Promise<Response>;

/**
 * Vendored replacement for the `x-forwarded-fetch` package (v0.2.0), which
 * rebuilt the request with the body passed as `await request.blob()`. undici's
 * `extractBody` turns a Blob body back into a stream via
 * `Blob.prototype.stream()`, and Node >= 24.16.0 never releases that stream's
 * reader-wakeup handle, permanently retaining every request body
 * (https://github.com/nodejs/node/issues/63574). Since this wraps the whole
 * app, each inbound POST leaked its body until the instance ran out of heap.
 *
 * Passing the body as plain bytes keeps the same fully-buffered semantics
 * without ever creating a Blob. The upstream Node fix
 * (https://github.com/nodejs/node/pull/63577) is not in any 24.x release yet;
 * even once it ships, the bytes path stays preferable — it avoids an
 * unnecessary copy on every request.
 */
export function behindProxy(fetch: FetchHandler): FetchHandler {
    return async (request) => await fetch(await getXForwardedRequest(request));
}

/**
 * Returns a new {@link Request} whose URL and Host reflect the
 * `X-Forwarded-Proto` / `X-Forwarded-Host` headers, with those headers
 * removed.
 */
export async function getXForwardedRequest(request: Request): Promise<Request> {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);

    const proto = request.headers.get('X-Forwarded-Proto');
    if (proto !== null) {
        url.protocol = `${proto}:`;
        headers.delete('X-Forwarded-Proto');
    }

    const host = request.headers.get('X-Forwarded-Host');
    if (host !== null) {
        url.host = host;
        const portMatch = host.match(/:(\d+)$/);
        url.port = portMatch ? portMatch[1] : '';
        headers.delete('X-Forwarded-Host');
        headers.delete('Host');
        headers.set('Host', host);
    }

    return new Request(url, {
        method: request.method,
        headers,
        body:
            request.method === 'GET' || request.method === 'HEAD'
                ? undefined
                : new Uint8Array(await request.arrayBuffer()),
        referrer: 'referrer' in request ? request.referrer : undefined,
        referrerPolicy: request.referrerPolicy,
        mode: request.mode,
        credentials: request.credentials,
        cache: request.cache,
        redirect: request.redirect,
        integrity: request.integrity,
        keepalive: request.keepalive,
        signal: request.signal,
    });
}
