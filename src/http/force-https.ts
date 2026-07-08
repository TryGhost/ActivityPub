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
 * This must wrap a `fetch()` function already decorated with `behindProxy`
 * (i.e. run before it), as `behindProxy` is what applies the header to the
 * request URL.
 *
 * @param fetch A `fetch()` function to be decorated
 */
export function forceHttps(fetch: (req: Request) => unknown) {
    return (request: Request) => {
        request.headers.set('x-forwarded-proto', 'https');
        return fetch(request);
    };
}
