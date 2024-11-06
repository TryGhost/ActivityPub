import { describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '@fedify/fedify';
import type { Context as HonoContext } from 'hono';

import type { HonoContextVariables } from '../app';

import {
    NODEINFO_PATH,
    nodeInfoDispatcher,
    nodeInfoMiddleware,
} from './nodeinfo';

describe('nodeInfo', () => {
    describe('nodeInfoMiddleware', () => {
        it('returns 404 if the site is not found', async () => {
            const ctxGet = vi.fn().mockReturnValue(null);

            const ctx = {
                get: ctxGet,
                req: { path: NODEINFO_PATH },
            } as unknown as HonoContext<{ Variables: HonoContextVariables }>;

            const next = vi.fn();

            const result = await nodeInfoMiddleware(ctx, next);

            expect(result).toBeInstanceOf(Response);
            expect(result?.status).toBe(404);
            expect(next).not.toHaveBeenCalled();
            expect(ctxGet).toHaveBeenCalledWith('site');
        });
    });

    describe('nodeInfoDispatcher', () => {
        it('returns the node info', async () => {
            const result = await nodeInfoDispatcher({} as RequestContext<any>);

            expect(result).toEqual({
                software: {
                    name: 'ghost',
                    version: { major: 0, minor: 1, patch: 0 },
                    homepage: new URL('https://ghost.org/'),
                    repository: new URL('https://github.com/TryGhost/Ghost'),
                },
                protocols: ['activitypub'],
                openRegistrations: false,
                usage: {
                    users: {},
                    localPosts: 0,
                    localComments: 0,
                },
            });
        });
    });
});
