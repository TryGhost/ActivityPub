import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as Sentry from '@sentry/node';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { AppContext } from '@/app';
import { SiteController } from '@/http/api/site.controller';
import type { Site, SiteService } from '@/site/site.service';

vi.mock('@sentry/node', () => ({
    captureException: vi.fn(),
}));

describe('SiteController', () => {
    let siteService: SiteService;
    let accountService: AccountService;
    let siteController: SiteController;
    let mockSite: Site;
    let mockAccount: Account;

    beforeEach(() => {
        mockSite = {
            id: 1,
            host: 'example.com',
            webhook_secret: 'secret',
            ghost_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
        };

        mockAccount = {
            id: 42,
            username: 'index',
            apId: new URL('https://example.com/.ghost/activitypub/users/index'),
        } as Account;

        siteService = {
            initialiseSiteForHost: vi.fn().mockResolvedValue(mockSite),
            getSiteByHost: vi.fn().mockResolvedValue(mockSite),
            disableSiteForHost: vi.fn().mockResolvedValue(true),
            softDisconnectSite: vi.fn().mockResolvedValue(true),
        } as unknown as SiteService;

        accountService = {
            // handleGetSiteData treats a missing account as "site only"
            getAccountForSite: vi.fn().mockResolvedValue(null),
        } as unknown as AccountService;
    });

    function getMockAppContext(
        host: string | undefined,
        headers: Record<string, string> = {},
    ): AppContext {
        return {
            req: {
                header: (name: string) => {
                    if (name === 'host') return host;
                    return headers[name] || undefined;
                },
                raw: {
                    socket: {
                        remoteAddress: headers['socket.remoteAddress'],
                    },
                },
            },
            get: vi.fn((key: string) => {
                if (key === 'logger') {
                    return {
                        info: vi.fn(),
                        warn: vi.fn(),
                        error: vi.fn(),
                    };
                }
                return undefined;
            }),
        } as unknown as AppContext;
    }

    function createController(ghostProIpAddresses?: string[]): SiteController {
        return new SiteController(
            siteService,
            accountService,
            ghostProIpAddresses,
        );
    }

    describe('handleGetSiteData', () => {
        it('returns 401 if no host header is provided', async () => {
            siteController = createController();
            const ctx = getMockAppContext(undefined);
            const response = await siteController.handleGetSiteData(ctx);

            expect(response.status).toBe(401);
            const body = await response.json();
            expect(body).toEqual({ error: 'No Host header' });
        });

        it('returns site data as JSON', async () => {
            siteController = createController();
            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleGetSiteData(ctx);

            expect(response.status).toBe(200);
            expect(response.headers.get('Content-Type')).toBe(
                'application/json',
            );

            const body = await response.json();
            expect(body).toEqual(mockSite);
        });

        it('returns site data when no account exists for the site', async () => {
            siteController = createController();

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleGetSiteData(ctx);

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual(mockSite);
        });

        it('returns account metadata without restoring Bridgy on GET', async () => {
            vi.mocked(accountService.getAccountForSite).mockResolvedValue(
                mockAccount,
            );
            siteController = createController();

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleGetSiteData(ctx);

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({
                ...mockSite,
                handle: '@index@example.com',
                actorUrl: mockAccount.apId.href,
            });
        });

        it('sets `ghost_pro` flag to false when none of the x-forwarded-for IP addresses matches any of the Ghost (Pro) IP addresses', async () => {
            siteController = createController(['10.0.0.1', '10.0.0.2']);
            const ctx = getMockAppContext('example.com', {
                'x-forwarded-for': '192.168.1.1, 218.123.123.123',
            });

            await siteController.handleGetSiteData(ctx);

            expect(siteService.initialiseSiteForHost).toHaveBeenCalledWith(
                'example.com',
                false,
            );
        });

        it('sets `ghost_pro` flag to true when one of the x-forwarded-for IP addresses matches a Ghost (Pro) IP address', async () => {
            siteController = createController(['10.0.0.1', '10.0.0.2']);
            const ctx = getMockAppContext('example.com', {
                'x-forwarded-for': '192.168.1.1, 10.0.0.1, 218.123.123.123',
            });

            await siteController.handleGetSiteData(ctx);

            expect(siteService.initialiseSiteForHost).toHaveBeenCalledWith(
                'example.com',
                true,
            );
        });

        it('sets `ghost_pro` flag to false when no IP headers are found', async () => {
            siteController = createController(['10.0.0.1', '10.0.0.2']);
            const ctx = getMockAppContext('example.com'); // no x-forwarded-for header

            await siteController.handleGetSiteData(ctx);

            expect(siteService.initialiseSiteForHost).toHaveBeenCalledWith(
                'example.com',
                false,
            );
        });
    });

    describe('handleDisableSite', () => {
        it('returns 401 if no host header is provided', async () => {
            siteController = createController();

            const ctx = getMockAppContext(undefined);
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(401);

            const body = await response.json();

            expect(body).toEqual({ error: 'No Host header' });
        });

        it('returns 200 if the site is disabled', async () => {
            vi.mocked(accountService.getAccountForSite).mockResolvedValue(
                mockAccount,
            );
            siteController = createController();

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(200);
            expect(siteService.getSiteByHost).toHaveBeenCalledWith(
                'example.com',
            );
            expect(accountService.getAccountForSite).toHaveBeenCalledWith(
                mockSite,
            );
            expect(siteService.softDisconnectSite).toHaveBeenCalledWith(
                mockAccount,
                mockSite,
            );
            expect(siteService.disableSiteForHost).not.toHaveBeenCalled();
        });

        it('falls back to deleting the site when soft disconnect fails', async () => {
            vi.mocked(accountService.getAccountForSite).mockResolvedValue(
                mockAccount,
            );
            siteController = createController();
            const error = new Error('bridgy unavailable');
            vi.mocked(siteService.softDisconnectSite).mockRejectedValue(error);

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(200);
            expect(siteService.disableSiteForHost).toHaveBeenCalledWith(
                'example.com',
            );
            expect(Sentry.captureException).toHaveBeenCalledWith(error);
        });

        it('still soft-disconnects when no account exists', async () => {
            siteController = createController();
            vi.mocked(accountService.getAccountForSite).mockRejectedValue(
                new Error('No user found for site: 1'),
            );

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(200);
            expect(siteService.softDisconnectSite).toHaveBeenCalledWith(
                null,
                mockSite,
            );
            expect(siteService.disableSiteForHost).not.toHaveBeenCalled();
        });

        it('returns 404 if the site is not found', async () => {
            siteController = createController();

            vi.mocked(siteService.getSiteByHost).mockResolvedValue(null);

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(404);
            expect(siteService.softDisconnectSite).not.toHaveBeenCalled();
            expect(siteService.disableSiteForHost).not.toHaveBeenCalled();
        });

        it('returns 500 if soft disconnect and fallback delete both fail', async () => {
            siteController = createController();

            vi.mocked(siteService.softDisconnectSite).mockRejectedValue(
                new Error('bridgy unavailable'),
            );
            vi.mocked(siteService.disableSiteForHost).mockRejectedValue(
                new Error('test'),
            );

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(500);

            const body = await response.text();

            expect(body).toEqual('test');
        });
    });
});
