import type { KvStore } from '@fedify/fedify';
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
    } catch (err) {
        if (retries === 0) {
            return null;
        }
        await sleep(100);
        return getKey(jwksURL, jwksCache, retries - 1);
    }
}

export function createRoleMiddleware(jwksCache: KvStore) {
    return async function roleMiddleware(ctx: HonoContext, next: Next) {
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            ctx.get('logger').error('No Host header');
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
            ctx.get('logger').error('Invalid Authorization header', {
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

        let protocol = 'https';
        // We allow insecure requests when not in production for things like testing
        if (
            !['staging', 'production'].includes(process.env.NODE_ENV || '') &&
            !request.raw.url.startsWith('https')
        ) {
            protocol = 'http';
        }

        const jwksURL = new URL(
            '/ghost/.well-known/jwks.json',
            `${protocol}://${host}`,
        );

        const key = await getKey(jwksURL, jwksCache);

        if (!key) {
            ctx.get('logger').error('No key found for {host}', { host });
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

        try {
            const claims = jwt.verify(token, key);
            if (typeof claims === 'string' || typeof claims.role !== 'string') {
                ctx.get('logger').error(
                    'Invalid claims for JWT - using Anonymous',
                    {
                        jwtClaims: claims,
                    },
                );
                ctx.set('role', GhostRole.Anonymous);
                return;
            }
            if (
                [
                    'Owner',
                    'Administrator',
                    'Editor',
                    'Author',
                    'Contributor',
                ].includes(claims.role)
            ) {
                ctx.set(
                    'role',
                    GhostRole[
                        claims.role as
                            | 'Owner'
                            | 'Administrator'
                            | 'Editor'
                            | 'Author'
                            | 'Contributor'
                    ],
                );
            } else {
                ctx.get('logger').error(
                    'Invalid role {role} - using Anonymous',
                    {
                        role: claims.role,
                    },
                );
                ctx.set('role', GhostRole.Anonymous);
            }
        } catch (err) {
            ctx.get('logger').error('Error verifying JWT', {
                error: err,
            });
            ctx.set('role', GhostRole.Anonymous);
        }

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
