import type { Protocol, RequestContext } from '@fedify/fedify';
import type { Context as HonoContext, Next } from 'hono';
import type { ContextData, HonoContextVariables } from '../app';

export const NODEINFO_PATH = '/.ghost/activitypub/nodeinfo/2.1';

export async function nodeInfoMiddleware(
    ctx: HonoContext<{ Variables: HonoContextVariables }>,
    next: Next,
) {
    const site = ctx.get('site');

    if (ctx.req.path === NODEINFO_PATH && !site) {
        return new Response(null, { status: 404 });
    }

    return next();
}

export async function nodeInfoDispatcher(ctx: RequestContext<ContextData>) {
    return {
        software: {
            name: 'ghost',
            version: { major: 0, minor: 1, patch: 0 },
            homepage: new URL('https://ghost.org/'),
            repository: new URL('https://github.com/TryGhost/Ghost'),
        },
        protocols: ['activitypub'] as Protocol[],
        openRegistrations: false,
        usage: {
            users: {},
            localPosts: 0,
            localComments: 0,
        },
    };
}
