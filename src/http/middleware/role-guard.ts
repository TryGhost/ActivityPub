import type { KvStore } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import type { Context as HonoContext, Next } from 'hono';
import jwt from 'jsonwebtoken';
import jose from 'node-jose';

export enum GhostRole {
    Anonymous = 'Anonymous',
    Owner = 'Owner',
    Administrator = 'Administrator',
    Editor = 'Editor',
    Author = 'Author',
    Contributor = 'Contributor',
}

function sleep(n: number) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

function getJwksURL(host: string, ctx: HonoContext) {
    const GHOST_JWKS_ENDPOINT = '/ghost/.well-known/jwks.json';

    let protocol = 'https';
    // We allow insecure requests when not in production for things like testing
    if (
        !['staging', 'production'].includes(process.env.NODE_ENV || '') &&
        !ctx.req.raw.url.startsWith('https')
    ) {
        protocol = 'http';
    }

    return new URL(GHOST_JWKS_ENDPOINT, `${protocol}://${host}`);
}

async function getKey(
    jwksURL: URL,
    jwksCache: KvStore,
    retries = 5,
): Promise<string | null> {
    try {
        const cachedKey = await jwksCache.get(['cachedJwks', jwksURL.hostname]);
        if (cachedKey && typeof cachedKey === 'string') {
            return cachedKey;
        }

        const jwksResponse = await fetch(jwksURL, {
            redirect: 'follow',
        });

        const jwks = await jwksResponse.json();

        const key = (await jose.JWK.asKey(jwks.keys[0])).toPEM();
        await jwksCache.set(['cachedJwks', jwksURL.hostname], key);

        return key;
    } catch (_err) {
        if (retries === 0) {
            return null;
        }
        await sleep(100);
        return getKey(jwksURL, jwksCache, retries - 1);
    }
}

async function verifyToken(
    token: string,
    key: string,
    jwksCache: KvStore,
    jwksURL: URL,
    logger: Logger,
): Promise<jwt.JwtPayload | string | null> {
    let claims: jwt.JwtPayload | string | null = null;

    try {
        claims = jwt.verify(token, key);
    } catch (err) {
        const shouldInvalidateCache =
            err instanceof jwt.JsonWebTokenError &&
            (err.message.includes('invalid signature') ||
                err.message.includes('invalid algorithm'));

        if (!shouldInvalidateCache) {
            logger.error('Error verifying JWT', {
                error: err,
            });

            return null;
        }

        logger.error(
            'Error verifying JWT: invalid signature/algorithm. Invalidating public key cache and retrying',
            {
                error: err,
            },
        );

        await jwksCache.delete(['cachedJwks', jwksURL.hostname]);
        const newKey = await getKey(jwksURL, jwksCache);

        if (!newKey) {
            logger.error(
                'Failed to fetch new public key after cache invalidation',
            );
            return null;
        }

        try {
            claims = jwt.verify(token, newKey);
        } catch (retryErr) {
            logger.error('Error verifying JWT after retry', {
                error: retryErr,
            });
        }
    }

    return claims;
}

function getRoleFromClaims(
    claims: string | jwt.JwtPayload,
    logger: Logger,
): GhostRole {
    if (typeof claims === 'string' || typeof claims.role !== 'string') {
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

export function createRoleMiddleware(jwksCache: KvStore) {
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
        const key = await getKey(jwksURL, jwksCache);

        if (!key) {
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

        const claims = await verifyToken(
            token,
            key,
            jwksCache,
            jwksURL,
            logger,
        );

        if (!claims) {
            ctx.set('role', GhostRole.Anonymous);
            return next();
        }

        const role = getRoleFromClaims(claims, logger);
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
