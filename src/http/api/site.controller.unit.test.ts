import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '@/app';
import { SiteController } from '@/http/api/site.controller';
import type { Site, SiteService } from '@/site/site.service';

describe('SiteController', () => {
    let siteService: SiteService;
    let siteController: SiteController;
    let mockSite: Site;

    beforeEach(() => {
        mockSite = {
            id: 1,
            host: 'example.com',
            webhook_secret: 'secret',
            ghost_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
        };

        siteService = {
            initialiseSiteForHost: vi.fn().mockResolvedValue(mockSite),
            disableSiteForHost: vi.fn().mockResolvedValue(true),
        } as unknown as SiteService;
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
                        error: vi.fn(),
                    };
                }
                return undefined;
            }),
        } as unknown as AppContext;
    }

    describe('handleGetSiteData', () => {
        it('returns 401 if no host header is provided', async () => {
            siteController = new SiteController(siteService);
            const ctx = getMockAppContext(undefined);
            const response = await siteController.handleGetSiteData(ctx);

            expect(response.status).toBe(401);
            const body = await response.json();
            expect(body).toEqual({ error: 'No Host header' });
        });

        it('returns site data as JSON', async () => {
            siteController = new SiteController(siteService);
            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleGetSiteData(ctx);

            expect(response.status).toBe(200);
            expect(response.headers.get('Content-Type')).toBe(
                'application/json',
            );

            const body = await response.json();
            expect(body).toEqual(mockSite);
        });

        it('sets `ghost_pro` flag to false when none of the x-forwarded-for IP addresses matches any of the Ghost (Pro) IP addresses', async () => {
            siteController = new SiteController(siteService, [
                '10.0.0.1',
                '10.0.0.2',
            ]);
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
            siteController = new SiteController(siteService, [
                '10.0.0.1',
                '10.0.0.2',
            ]);
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
            siteController = new SiteController(siteService, [
                '10.0.0.1',
                '10.0.0.2',
            ]);
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
            siteController = new SiteController(siteService);

            const ctx = getMockAppContext(undefined);
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(401);

            const body = await response.json();

            expect(body).toEqual({ error: 'No Host header' });
        });

        it('returns 200 if the site is disabled', async () => {
            siteController = new SiteController(siteService);

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(200);
        });

        it('returns 404 if the site is not found', async () => {
            siteController = new SiteController(siteService);

            vi.mocked(siteService.disableSiteForHost).mockResolvedValue(false);

            const ctx = getMockAppContext('example.com');
            const response = await siteController.handleDisableSite(ctx);

            expect(response.status).toBe(404);
        });

        it('returns 500 if an error occurs', async () => {
            siteController = new SiteController(siteService);

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
