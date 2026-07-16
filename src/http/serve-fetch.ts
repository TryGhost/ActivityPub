import { behindProxy } from 'x-forwarded-fetch';

import { isLocalEnvironment } from '@/helpers/environment';

/**
 * Decorate a `fetch()` function so that the request is always treated as
 * having been made over https.
 *
 * Canonical URLs are always https (see `AccountEntity.draft` /
 * `AccountService.createInternalAccount`), but Fedify derives generated URIs
 * (e.g. the actor's `publicKey.id`) from the incoming request URL. A reverse
 * proxy that omits the `X-Forwarded-Proto` header would leave the request URL
 * as http, producing http URIs that contradict the stored https actor IDs and
 * breaking HTTP signature verification on remote servers.
 *
 * Fedify's `origin` option on `createFederation` would be the first-class way
 * to pin generated URIs, but it takes a single static origin — unusable here,
 * where the host varies per tenant.
 *
 * This must wrap a `fetch()` function already decorated with `behindProxy`
 * (i.e. run before it), as `behindProxy` is what applies the header to the
 * request URL — `createServeFetch` owns that composition.
 */
function forceHttps(fetch: (req: Request) => unknown) {
    return (request: Request) => {
        request.headers.set('x-forwarded-proto', 'https');
        return fetch(request);
    };
}

function forceAcceptHeader(fetch: (req: Request) => unknown) {
    return (request: Request) => {
        request.headers.set('accept', 'application/activity+json');
        return fetch(request);
    };
}

/**
 * Build the `fetch()` function passed to `serve()`: applies `X-Forwarded-*`
 * headers to the request URL and forces the accept header, and — outside
 * local environments, which serve plain http — forces the https scheme so
 * generated URIs match the stored https canonical URLs regardless of proxy
 * configuration.
 *
 * @param environment `process.env.NODE_ENV`
 * @param fetch The app's `fetch()` function
 */
export function createServeFetch(
    environment: string | undefined,
    fetch: (request: Request) => Response | Promise<Response>,
) {
    const proxiedFetch = behindProxy(fetch);

    return forceAcceptHeader(
        isLocalEnvironment(environment)
            ? proxiedFetch
            : forceHttps(proxiedFetch),
    );
}
