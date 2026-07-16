/**
 * Environments that run over plain http (local development and CI). Code that
 * follows the request scheme (e.g. the JWKS lookup in the role middleware)
 * relies on requests staying http in these environments, and the serve
 * boundary must not force the scheme to https for them (see
 * `createServeFetch`).
 *
 * Every other environment — including an unset or unrecognised `NODE_ENV` —
 * is treated as being served over https, matching the canonical account URLs
 * which are always created with an https scheme
 * (`AccountService.createInternalAccount`).
 */
const LOCAL_ENVIRONMENTS = ['development', 'testing'];

export function isLocalEnvironment(environment: string | undefined): boolean {
    return LOCAL_ENVIRONMENTS.includes(environment || '');
}
