import type { KvKey, KvStore } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import type { Context as HonoContext, Next } from 'hono';
import {
    decodeProtectedHeader,
    importJWK,
    type JWK,
    type JWTPayload,
    jwtVerify,
} from 'jose';

import {
    error,
    exhaustiveCheck,
    getError,
    getValue,
    isError,
    ok,
    type Result,
} from '@/core/result';
import { isLocalEnvironment } from '@/helpers/environment';

export enum GhostRole {
    Anonymous = 'Anonymous',
    Owner = 'Owner',
    Administrator = 'Administrator',
    Editor = 'Editor',
    Author = 'Author',
    Contributor = 'Contributor',
}

/**
 * Ghost signs staff identity tokens with RS256 only
 */
const TOKEN_ALGORITHM = 'RS256';

/**
 * How long a site's key set is cached for before it is fetched again
 */
const DEFAULT_KEY_SET_TTL = Temporal.Duration.from({ hours: 1 });

/**
 * Minimum time between refetches of a site's key set triggered by a token
 * signed with a key we don't know about
 */
const DEFAULT_REFETCH_COOLDOWN_MS = 30_000;

type KeySet = {
    keys: JWK[];
};

type VerifyTokenError =
    | { type: 'unknown-key'; kid: string }
    | { type: 'invalid-token'; error: unknown };

interface RoleMiddlewareOptions {
    keySetTtl?: Temporal.Duration;
    refetchCooldownMs?: number;
    now?: () => number;
}

function sleep(n: number) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

function getJwksURL(host: string, ctx: HonoContext) {
    const GHOST_JWKS_ENDPOINT = '/ghost/.well-known/jwks.json';

    let protocol = 'https';
    // We allow insecure requests in local environments for things like testing
    if (
        isLocalEnvironment(process.env.NODE_ENV) &&
        !ctx.req.raw.url.startsWith('https')
    ) {
        protocol = 'http';
    }

    return new URL(GHOST_JWKS_ENDPOINT, `${protocol}://${host}`);
}

function getKeySetCacheKey(jwksURL: URL): KvKey {
    return ['cachedJwksSet', jwksURL.hostname];
}

async function getCachedKeySet(
    jwksURL: URL,
    jwksCache: KvStore,
): Promise<KeySet | null> {
    const cached = await jwksCache.get<KeySet>(getKeySetCacheKey(jwksURL));

    if (cached && Array.isArray(cached.keys) && cached.keys.length > 0) {
        return cached;
    }

    return null;
}

async function fetchKeySet(
    jwksURL: URL,
    jwksCache: KvStore,
    keySetTtl: Temporal.Duration,
    bypassCache: boolean,
    retries = 5,
): Promise<KeySet | null> {
    try {
        const jwksResponse = await fetch(jwksURL, {
            redirect: 'follow',
            // Ask any caches in front of the site (i.e. a CDN) for a fresh
            // copy when we're looking for a key the cached copy may not have
            headers: bypassCache ? { 'Cache-Control': 'no-cache' } : {},
        });

        if (!jwksResponse.ok) {
            throw new Error(
                `Unexpected JWKS response status: ${jwksResponse.status}`,
            );
        }

        const jwks = await jwksResponse.json();

        const keys = (Array.isArray(jwks?.keys) ? jwks.keys : []).filter(
            (key: JWK) =>
                key?.kty === 'RSA' &&
                (key.use === undefined || key.use === 'sig'),
        );

        if (keys.length === 0) {
            throw new Error('JWKS contains no usable keys');
        }

        const keySet: KeySet = { keys };

        await jwksCache.set(getKeySetCacheKey(jwksURL), keySet, {
            ttl: keySetTtl,
        });

        return keySet;
    } catch (_err) {
        if (retries === 0) {
            return null;
        }
        await sleep(100);
        return fetchKeySet(
            jwksURL,
            jwksCache,
            keySetTtl,
            bypassCache,
            retries - 1,
        );
    }
}

/**
 * Verify a token against a key set. The key is selected using the `kid` in
 * the token header - tokens without a `kid` are tried against every key.
 */
async function verifyToken(
    token: string,
    keySet: KeySet,
): Promise<Result<JWTPayload, VerifyTokenError>> {
    let kid: string | undefined;

    try {
        kid = decodeProtectedHeader(token).kid;
    } catch (err) {
        return error({ type: 'invalid-token', error: err });
    }

    const candidates =
        kid === undefined
            ? keySet.keys
            : keySet.keys.filter((key) => key.kid === kid);

    if (kid !== undefined && candidates.length === 0) {
        return error({ type: 'unknown-key', kid });
    }

    let lastError: unknown = null;

    for (const jwk of candidates) {
        try {
            const key = await importJWK(jwk, TOKEN_ALGORITHM);
            const { payload } = await jwtVerify(token, key, {
                algorithms: [TOKEN_ALGORITHM],
                // Ghost's tokens always expire, and jose only checks `exp`
                // when it is present
                requiredClaims: ['exp'],
            });

            return ok(payload);
        } catch (err) {
            lastError = err;
        }
    }

    return error({ type: 'invalid-token', error: lastError });
}

function getRoleFromClaims(claims: JWTPayload, logger: Logger): GhostRole {
    if (typeof claims.role !== 'string') {
        logger.error('Invalid claims for JWT - using Anonymous', {
            jwtClaims: claims,
        });
        return GhostRole.Anonymous;
    }

    if (
        ['Owner', 'Administrator', 'Editor', 'Author', 'Contributor'].includes(
            claims.role,
        )
    ) {
        return GhostRole[
            claims.role as
                | 'Owner'
                | 'Administrator'
                | 'Editor'
                | 'Author'
                | 'Contributor'
        ];
    }

    logger.error('Invalid role {role} - using Anonymous', {
        role: claims.role,
    });
    return GhostRole.Anonymous;
}

export function createRoleMiddleware(
    jwksCache: KvStore,
    {
        keySetTtl = DEFAULT_KEY_SET_TTL,
        refetchCooldownMs = DEFAULT_REFETCH_COOLDOWN_MS,
        now = Date.now,
    }: RoleMiddlewareOptions = {},
) {
    // Per-instance record of when each host's key set was last refetched
    // because of an unknown key, so a flood of tokens with unknown keys can't
    // make us repeatedly hit the site
    const lastRefetchAt = new Map<string, number>();

    function tryStartRefetch(host: string): boolean {
        const currentTime = now();

        for (const [cachedHost, refetchedAt] of lastRefetchAt) {
            if (currentTime - refetchedAt >= refetchCooldownMs) {
                lastRefetchAt.delete(cachedHost);
            }
        }

        if (lastRefetchAt.has(host)) {
            return false;
        }

        lastRefetchAt.set(host, currentTime);

        return true;
    }

    return async function roleMiddleware(ctx: HonoContext, next: Next) {
        const request = ctx.req;
        const host = request.header('host');
        const logger = ctx.get('logger');

        if (!host) {
            logger.error('No Host header');
            return new Response(
                JSON.stringify({
                    error: 'Unauthorized',
                    code: 'HOST_MISSING',
                }),
                {
                    status: 401,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );
        }

        ctx.set('role', GhostRole.Anonymous);

        const authorization = request.header('authorization');
        if (!authorization) {
            return next();
        }

        const [match, token] = authorization.match(/Bearer\s+(.*)$/) || [null];

        if (!match) {
            logger.error('Invalid Authorization header', {
                headerValue: authorization,
            });
            return new Response(
                JSON.stringify({
                    error: 'Unauthorized',
                    code: 'INVALID_AUTHORIZATION_HEADER',
                }),
                {
                    status: 401,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );
        }

        const jwksURL = getJwksURL(host, ctx);

        let keySet = await getCachedKeySet(jwksURL, jwksCache);

        if (!keySet) {
            keySet = await fetchKeySet(jwksURL, jwksCache, keySetTtl, false);
        }

        if (!keySet) {
            logger.error('No key found for {host}', { host });
            return new Response(
                JSON.stringify({
                    error: 'Unauthorized',
                    code: 'JWKS_MISSING',
                }),
                {
                    status: 401,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );
        }

        let result = await verifyToken(token, keySet);

        if (isError(result)) {
            const err = getError(result);

            if (
                err.type === 'unknown-key' &&
                tryStartRefetch(jwksURL.hostname)
            ) {
                logger.info(
                    'JWT signed with unknown key {kid} - refetching key set for {host}',
                    { kid: err.kid, host },
                );

                const refetchedKeySet = await fetchKeySet(
                    jwksURL,
                    jwksCache,
                    keySetTtl,
                    true,
                );

                if (refetchedKeySet) {
                    result = await verifyToken(token, refetchedKeySet);
                }
            }
        }

        if (isError(result)) {
            const err = getError(result);

            switch (err.type) {
                case 'unknown-key':
                    logger.error(
                        'Error verifying JWT: no key found for {kid} on {host}',
                        { kid: err.kid, host },
                    );
                    break;
                case 'invalid-token':
                    logger.error('Error verifying JWT', { error: err.error });
                    break;
                default:
                    exhaustiveCheck(err);
            }

            ctx.set('role', GhostRole.Anonymous);
            return next();
        }

        const role = getRoleFromClaims(getValue(result), logger);
        ctx.set('role', role);

        await next();
    };
}

export function requireRole(...roles: GhostRole[]) {
    return function roleMiddleware(ctx: HonoContext, next: Next) {
        if (!roles.includes(ctx.get('role'))) {
            ctx.get('logger').error(
                'User role {userRole} is not allowed to access this resource',
                {
                    userRole: ctx.get('role'),
                    allowedRoles: roles,
                },
            );
            return new Response(
                JSON.stringify({
                    error: 'Forbidden',
                    code: 'ROLE_MISSING',
                }),
                {
                    status: 403,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );
        }
        return next();
    };
}
