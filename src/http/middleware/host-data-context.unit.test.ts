import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';
import { Hono } from 'hono';

import type { Account } from '@/account/account.entity';
import type { HonoContextVariables } from '@/app';
import { error } from '@/core/result';
import type { HostDataContextLoader } from '@/http/host-data-context-loader';
import { createHostDataContextMiddleware } from '@/http/middleware/host-data-context';
import type { Site } from '@/site/site.service';

describe('hostDataContextMiddleware', () => {
    let app: Hono<{ Variables: HonoContextVariables }>;

    beforeEach(() => {
        app = new Hono<{ Variables: HonoContextVariables }>();

        app.use(async (c, next) => {
            c.set('logger', {
                info: vi.fn(),
                error: vi.fn(),
            } as unknown as Logger);

            await next();
        });
    });

    it('should return a 401 response when no host header is provided', async () => {
        const mockLoader = {} as HostDataContextLoader;

        app.use(createHostDataContextMiddleware(mockLoader));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            // No host header provided
        });

        expect(res.status).toBe(401);
        expect(await res.text()).toBe('No Host header');
    });

    it('should return a 403 response when the site associated with the host is not found', async () => {
        const host = 'example.com';
        const mockLoader = {
            loadDataForHost: vi.fn().mockResolvedValue(error('site-not-found')),
        } as unknown as HostDataContextLoader;

        app.use(createHostDataContextMiddleware(mockLoader));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            headers: {
                host,
            },
        });

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
            error: 'Forbidden',
            code: 'SITE_MISSING',
        });
        expect(mockLoader.loadDataForHost).toHaveBeenCalledWith(host);
    });

    it('should return a 401 response when the account associated with the host is not found', async () => {
        const host = 'example.com';
        const mockLoader = {
            loadDataForHost: vi
                .fn()
                .mockResolvedValue(error('account-not-found')),
        } as unknown as HostDataContextLoader;

        app.use(createHostDataContextMiddleware(mockLoader));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            headers: {
                host,
            },
        });

        expect(res.status).toBe(401);
        expect(await res.text()).toBe('No account found');
        expect(mockLoader.loadDataForHost).toHaveBeenCalledWith(host);
    });

    it('should return a 401 response when multiple users exist for the site associated with the host', async () => {
        const host = 'example.com';
        const mockLoader = {
            loadDataForHost: vi
                .fn()
                .mockResolvedValue(error('multiple-users-for-site')),
        } as unknown as HostDataContextLoader;

        app.use(createHostDataContextMiddleware(mockLoader));

        app.get('/test', (c) => c.text('ok'));

        const res = await app.request('/test', {
            headers: {
                host,
            },
        });

        expect(res.status).toBe(401);
        expect(await res.text()).toBe('No account found');
        expect(mockLoader.loadDataForHost).toHaveBeenCalledWith(host);
    });

    it('should set the resolved site and account on the context and call the next middleware when successful', async () => {
        const host = 'example.com';
        const mockSite = {
            id: 123,
            host,
            webhook_secret: 's3cr3t',
            ghost_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
        };
        const mockAccount = {
            id: 456,
            uuid: 'e0887c9e-1829-4c27-8517-93a2f57045a2',
            username: 'foo',
            name: 'Foo Bar',
            bio: null,
            url: `https://${host}`,
            avatarUrl: null,
            bannerImageUrl: null,
            apId: `https://${host}/activitypub/actor/foo`,
            apFollowersUrl: `https://${host}/activitypub/actor/foo/followers`,
            apInboxUrl: `https://${host}/activitypub/actor/foo/inbox`,
            customFields: null,
            siteId: mockSite.id,
        };

        const mockLoader = {
            loadDataForHost: vi
                .fn()
                .mockResolvedValue([
                    null,
                    { site: mockSite, account: mockAccount },
                ]),
        } as unknown as HostDataContextLoader;

        app.use(createHostDataContextMiddleware(mockLoader));

        let ctxSite: Site | undefined;
        let ctxAccount: Account | undefined;
        let nextCalled = false;

        app.get('/test', (c) => {
            ctxSite = c.get('site');
            ctxAccount = c.get('account');
            nextCalled = true;

            return c.text('ok');
        });

        const res = await app.request('/test', {
            headers: {
                host,
            },
        });

        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ok');
        expect(mockLoader.loadDataForHost).toHaveBeenCalledWith(host);
        expect(ctxSite).toEqual(mockSite);
        expect(ctxAccount).toEqual(mockAccount);
        expect(nextCalled).toBe(true);
    });
});
