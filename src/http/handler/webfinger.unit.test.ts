import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account } from 'account/account.entity';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { Context } from 'hono';
import type { Site, SiteService } from 'site/site.service';
import { createWebFingerHandler } from './webfinger.controller';

describe('handleWebFinger', () => {
    let siteService: SiteService;
    let accountRepository: KnexAccountRepository;

    function getCtx(queries: Record<string, string>) {
        return {
            req: {
                query: (key: string) => {
                    return queries[key];
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
        } as unknown as KnexAccountRepository;
    });

    it('should fallback to the default webfinger implementation if the resource is falsy', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

        const ctx = getCtx({});
        const next = vi.fn();

        await handleWebFinger(ctx, next);

        expect(next).toHaveBeenCalled();
    });

    it('should fallback to the default webfinger implementation if the resource is not an acct: resource', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

        const ctx = getCtx({ resource: 'https://example.com' });
        const next = vi.fn();

        await handleWebFinger(ctx, next);

        expect(next).toHaveBeenCalled();
    });

    it('should handle a malformed acct: resource', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

        const ctx = getCtx({ resource: 'acct:alice' }); // missing @
        const next = vi.fn();

        const response = await handleWebFinger(ctx, next);

        expect(response?.status).toBe(400);
        expect(siteService.getSiteByHost).not.toHaveBeenCalled();
    });

    it('should handle an invalid acct: resource', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

        const ctx = getCtx({ resource: 'acct:alice@example' }); // missing .com
        const next = vi.fn();

        const response = await handleWebFinger(ctx, next);

        expect(response?.status).toBe(400);
        expect(siteService.getSiteByHost).not.toHaveBeenCalled();
    });

    it('should return a 404 if no site is found for the resource', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

        const ctx = getCtx({ resource: 'acct:alice@example.com' });
        const next = vi.fn();

        vi.mocked(siteService.getSiteByHost).mockResolvedValue(null);

        const response = await handleWebFinger(ctx, next);

        expect(response?.status).toBe(404);
        expect(siteService.getSiteByHost).toHaveBeenCalledWith(
            'www.example.com',
        );
    });

    it('should return a 404 if no account is found for the site associated with the resource', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

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

        const response = await handleWebFinger(ctx, next);

        expect(response?.status).toBe(404);
        expect(siteService.getSiteByHost).toHaveBeenCalledWith(
            'www.example.com',
        );
    });

    it('should return a custom webfinger response', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

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
        } as unknown as Account);

        const response = await handleWebFinger(ctx, next);

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

    it('should handle a multi-level subdomain', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

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
        } as unknown as Account);

        const response = await handleWebFinger(ctx, next);

        expect(response?.status).toBe(200);
    });

    it('should ensure the www is not included in the subject', async () => {
        const handleWebFinger = createWebFingerHandler(
            accountRepository,
            siteService,
        );

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
        } as unknown as Account);

        const response = await handleWebFinger(ctx, next);

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
