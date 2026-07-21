import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Context } from 'hono';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { WebFingerController } from '@/http/api/webfinger.controller';
import type { Site, SiteService } from '@/site/site.service';

describe('handleWebFinger', () => {
    let siteService: SiteService;
    let accountRepository: KnexAccountRepository;
    let webFingerController: WebFingerController;

    function getCtx(queries: Record<string, string>, host = 'example.com') {
        return {
            req: {
                query: (key: string) => {
                    return queries[key];
                },
                header: (key: string) => {
                    if (key === 'host') {
                        return host;
                    }
                    return undefined;
                },
            },
        } as unknown as Context;
    }

    beforeEach(() => {
        siteService = {
            getSiteByHost: vi.fn(),
        } as unknown as SiteService;
        accountRepository = {
            getBySite: vi.fn(),
            getByWebfingerHandle: vi.fn().mockResolvedValue(null),
        } as unknown as KnexAccountRepository;
        webFingerController = new WebFingerController(
            accountRepository,
            siteService,
        );
    });

    it('should fallback to the default webfinger implementation if the resource is falsy', async () => {
        const ctx = getCtx({});
        const next = vi.fn();

        await webFingerController.handleWebFinger(ctx, next);

        expect(next).toHaveBeenCalled();
    });

    it('should fallback to the default webfinger implementation if the resource is not an acct: resource', async () => {
        const ctx = getCtx({ resource: 'https://example.com' });
        const next = vi.fn();

        await webFingerController.handleWebFinger(ctx, next);

        expect(next).toHaveBeenCalled();
    });

    it('should handle a malformed acct: resource', async () => {
        const ctx = getCtx({ resource: 'acct:alice' }); // missing @
        const next = vi.fn();

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(400);
        expect(siteService.getSiteByHost).not.toHaveBeenCalled();
    });

    it('should return a custom webfinger response for a configured custom domain', async () => {
        const ctx = getCtx({ resource: 'acct:alice@example.com' });
        const next = vi.fn();

        vi.mocked(accountRepository.getByWebfingerHandle).mockResolvedValue({
            username: 'alice',
            url: 'https://blog.example.com',
            apId: new URL(
                'https://blog.example.com/.ghost/activitypub/users/index',
            ),
            webfingerHost: 'example.com',
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@example.com',
            aliases: [
                'https://blog.example.com/.ghost/activitypub/users/index',
            ],
        });
        expect(accountRepository.getByWebfingerHandle).toHaveBeenCalledWith(
            'alice',
            'example.com',
        );
        expect(siteService.getSiteByHost).not.toHaveBeenCalled();
    });

    it('should allow actor-host webfinger to validate an unsaved custom domain', async () => {
        const ctx = getCtx(
            { resource: 'acct:alice@example.com' },
            'blog.example.com',
        );
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'blog.example.com') {
                return Promise.resolve({
                    host: 'blog.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://blog.example.com',
            apId: new URL(
                'https://blog.example.com/.ghost/activitypub/users/index',
            ),
            webfingerHost: null,
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@example.com',
            aliases: [
                'https://blog.example.com/.ghost/activitypub/users/index',
            ],
        });
    });

    it('should allow actor-host webfinger to validate a replacement custom domain', async () => {
        const ctx = getCtx(
            { resource: 'acct:alice@new.example.com' },
            'blog.example.com',
        );
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'blog.example.com') {
                return Promise.resolve({
                    host: 'blog.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://blog.example.com',
            apId: new URL(
                'https://blog.example.com/.ghost/activitypub/users/index',
            ),
            webfingerHost: 'old.example.com',
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@new.example.com',
            aliases: [
                'https://blog.example.com/.ghost/activitypub/users/index',
            ],
        });
    });

    it('should return the configured custom subject from the actor host', async () => {
        const ctx = getCtx(
            { resource: 'acct:alice@blog.example.com' },
            'blog.example.com',
        );
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'blog.example.com') {
                return Promise.resolve({
                    host: 'blog.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://blog.example.com',
            apId: new URL(
                'https://blog.example.com/.ghost/activitypub/users/index',
            ),
            webfingerHost: 'example.com',
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@example.com',
            aliases: [
                'https://blog.example.com/.ghost/activitypub/users/index',
            ],
        });
    });

    it('should handle an invalid acct: resource', async () => {
        const ctx = getCtx({ resource: 'acct:alice@example' }); // missing .com
        const next = vi.fn();

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(400);
        expect(siteService.getSiteByHost).not.toHaveBeenCalled();
    });

    it('should return a 404 if no site is found for the resource', async () => {
        const ctx = getCtx(
            { resource: 'acct:alice@example.com' },
            'blog.example.com',
        );
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockResolvedValue(null);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(404);
        expect(siteService.getSiteByHost).toHaveBeenCalledWith(
            'www.example.com',
        );
    });

    it('should fall through when the request host has no site for same-host WebFinger', async () => {
        const ctx = getCtx({ resource: 'acct:alice@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockResolvedValue(null);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    it('should return a 404 if no account is found for the site associated with the resource', async () => {
        const ctx = getCtx({ resource: 'acct:alice@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'www.example.com') {
                return Promise.resolve({
                    host: 'www.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockRejectedValue(
            new Error('No account found'),
        );

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(404);
        expect(siteService.getSiteByHost).toHaveBeenCalledWith(
            'www.example.com',
        );
    });

    it('should return a custom webfinger response', async () => {
        const ctx = getCtx({ resource: 'acct:alice@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'www.example.com') {
                return Promise.resolve({
                    host: 'www.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://www.example.com',
            apId: new URL('https://www.example.com/users/alice'),
            webfingerHost: null,
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual({
            subject: 'acct:alice@example.com',
            aliases: ['https://www.example.com/users/alice'],
            links: [
                {
                    rel: 'self',
                    href: 'https://www.example.com/users/alice',
                    type: 'application/activity+json',
                },
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: 'https://www.example.com',
                },
            ],
        });
        expect(response?.headers.get('Content-Type')).toBe(
            'application/jrd+json',
        );
    });

    it('should resolve the stable actor username after the display username changes', async () => {
        const ctx = getCtx({ resource: 'acct:index@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'www.example.com') {
                return Promise.resolve({
                    host: 'www.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://www.example.com',
            apId: new URL('https://www.example.com/users/index'),
            webfingerHost: null,
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@example.com',
            aliases: ['https://www.example.com/users/index'],
        });
    });

    it('should resolve via the www site when a stale bare-host site does not match the username', async () => {
        const ctx = getCtx({ resource: 'acct:alice@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'example.com') {
                return Promise.resolve({ host: 'example.com' } as Site);
            }
            if (host === 'www.example.com') {
                return Promise.resolve({ host: 'www.example.com' } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockImplementation((site) => {
            if (site.host === 'example.com') {
                // Stale registration left behind by a domain change,
                // still on the original username
                return Promise.resolve({
                    username: 'index',
                    url: 'https://example.com',
                    apId: new URL('https://example.com/users/index'),
                    webfingerHost: null,
                } as unknown as Account);
            }

            // Live registration whose display username was changed
            return Promise.resolve({
                username: 'alice',
                url: 'https://www.example.com',
                apId: new URL('https://www.example.com/users/index'),
                webfingerHost: null,
            } as unknown as Account);
        });

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@example.com',
            aliases: ['https://www.example.com/users/index'],
        });
    });

    it('should prefer the bare-host site when both variants match the username', async () => {
        const ctx = getCtx({ resource: 'acct:index@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'example.com') {
                return Promise.resolve({ host: 'example.com' } as Site);
            }
            if (host === 'www.example.com') {
                return Promise.resolve({ host: 'www.example.com' } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockImplementation((site) => {
            if (site.host === 'example.com') {
                return Promise.resolve({
                    username: 'index',
                    url: 'https://example.com',
                    apId: new URL('https://example.com/users/index'),
                    webfingerHost: null,
                } as unknown as Account);
            }

            return Promise.resolve({
                username: 'index',
                url: 'https://www.example.com',
                apId: new URL('https://www.example.com/users/index'),
                webfingerHost: null,
            } as unknown as Account);
        });

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:index@example.com',
            aliases: ['https://example.com/users/index'],
        });
    });

    it('should resolve via the www site when the bare-host site account fails to load', async () => {
        const ctx = getCtx({ resource: 'acct:alice@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'example.com') {
                return Promise.resolve({ host: 'example.com' } as Site);
            }
            if (host === 'www.example.com') {
                return Promise.resolve({ host: 'www.example.com' } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockImplementation((site) => {
            if (site.host === 'example.com') {
                return Promise.reject(new Error('No account found'));
            }

            return Promise.resolve({
                username: 'alice',
                url: 'https://www.example.com',
                apId: new URL('https://www.example.com/users/alice'),
                webfingerHost: null,
            } as unknown as Account);
        });

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@example.com',
            aliases: ['https://www.example.com/users/alice'],
        });
    });

    it('should return 404 when neither host variant matches the username', async () => {
        const ctx = getCtx({ resource: 'acct:bob@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'example.com') {
                return Promise.resolve({ host: 'example.com' } as Site);
            }
            if (host === 'www.example.com') {
                return Promise.resolve({ host: 'www.example.com' } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockImplementation((site) => {
            if (site.host === 'example.com') {
                return Promise.resolve({
                    username: 'index',
                    url: 'https://example.com',
                    apId: new URL('https://example.com/users/index'),
                    webfingerHost: null,
                } as unknown as Account);
            }

            return Promise.resolve({
                username: 'alice',
                url: 'https://www.example.com',
                apId: new URL('https://www.example.com/users/index'),
                webfingerHost: null,
            } as unknown as Account);
        });

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(404);
        expect(next).not.toHaveBeenCalled();
    });

    it('should resolve a custom domain via the www variant of the request host when the bare request host does not match', async () => {
        const ctx = getCtx(
            { resource: 'acct:alice@custom.example.com' },
            'blog.example.com',
        );
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'blog.example.com') {
                return Promise.resolve({ host: 'blog.example.com' } as Site);
            }
            if (host === 'www.blog.example.com') {
                return Promise.resolve({
                    host: 'www.blog.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockImplementation((site) => {
            if (site.host === 'blog.example.com') {
                // Stale registration left behind by a domain change
                return Promise.resolve({
                    username: 'bob',
                    url: 'https://blog.example.com',
                    apId: new URL('https://blog.example.com/users/bob'),
                    webfingerHost: null,
                } as unknown as Account);
            }

            return Promise.resolve({
                username: 'alice',
                url: 'https://www.blog.example.com',
                apId: new URL('https://www.blog.example.com/users/index'),
                webfingerHost: null,
            } as unknown as Account);
        });

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toMatchObject({
            subject: 'acct:alice@custom.example.com',
            aliases: ['https://www.blog.example.com/users/index'],
        });
    });

    it('should return 404 when the resource username does not match the site account', async () => {
        const ctx = getCtx({ resource: 'acct:bob@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'www.example.com') {
                return Promise.resolve({
                    host: 'www.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://www.example.com',
            apId: new URL('https://www.example.com/users/alice'),
            webfingerHost: null,
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(404);
    });

    it('should handle a multi-level subdomain', async () => {
        const ctx = getCtx({ resource: 'acct:alice@sub.example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'www.sub.example.com') {
                return Promise.resolve({
                    host: 'www.sub.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://www.sub.example.com',
            apId: new URL('https://www.sub.example.com/users/alice'),
            webfingerHost: null,
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
    });

    it('should ensure the www is not included in the subject', async () => {
        const ctx = getCtx({ resource: 'acct:alice@www.example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockImplementation((host) => {
            if (host === 'www.example.com') {
                return Promise.resolve({
                    host: 'www.example.com',
                } as Site);
            }

            return Promise.resolve(null);
        });

        vi.mocked(accountRepository.getBySite).mockResolvedValue({
            username: 'alice',
            url: 'https://www.example.com',
            apId: new URL('https://www.example.com/users/alice'),
            webfingerHost: null,
        } as unknown as Account);

        const response = await webFingerController.handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual({
            subject: 'acct:alice@example.com',
            aliases: ['https://www.example.com/users/alice'],
            links: [
                {
                    rel: 'self',
                    href: 'https://www.example.com/users/alice',
                    type: 'application/activity+json',
                },
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: 'https://www.example.com',
                },
            ],
        });
        expect(response?.headers.get('Content-Type')).toBe(
            'application/jrd+json',
        );
    });
});
