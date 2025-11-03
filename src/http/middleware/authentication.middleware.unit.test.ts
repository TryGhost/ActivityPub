import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';
import { Hono } from 'hono';

import type { Account } from '@/account/account.entity';
import { AccountEntity } from '@/account/account.entity';
import type { Site } from '@/site/site.service';
import { error, ok } from '@/core/result';
import { AuthenticationMiddleware } from '@/http/middleware/authentication.middleware';
import type { SiteAccountView } from '@/http/middleware/site-account.view';

type TestContextVariables = {
    logger?: Logger;
    site?: Site;
    account?: Account;
};

describe('AuthenticationMiddleware', () => {
    let middleware: AuthenticationMiddleware;
    let mockSiteAccountView: SiteAccountView;
    let mockLogger: Logger;

    beforeEach(() => {
        mockSiteAccountView = {
            getBySiteHost: vi.fn(),
        } as unknown as SiteAccountView;

        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
        } as unknown as Logger;

        middleware = new AuthenticationMiddleware(
            mockSiteAccountView,
            mockLogger,
        );
    });

    describe('handle', () => {
        it('should return 401 when no Host header is provided', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'missing-host',
                    message: 'No Host header provided',
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('ok'));

            const res = await app.request('/test', {
                headers: {},
            });

            expect(res.status).toBe(401);
            const text = await res.text();
            expect(text).toBe('No Host header');
        });

        it('should return 403 when site is not found', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'site-not-found',
                    host: 'unknown.example.com',
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('ok'));

            const res = await app.request('/test', {
                headers: {
                    Host: 'unknown.example.com',
                },
            });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json).toEqual({
                error: 'Forbidden',
                code: 'SITE_MISSING',
            });
        });

        it('should return 401 when account is not found for site', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'account-not-found',
                    siteId: 1,
                    host: 'example.com',
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('ok'));

            const res = await app.request('/test', {
                headers: {
                    Host: 'example.com',
                },
            });

            expect(res.status).toBe(401);
            const text = await res.text();
            expect(text).toBe('No account found');
        });

        it('should set site and account in context when authentication succeeds', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            const mockSite = {
                id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
            };

            const mockAccount = AccountEntity.create({
                id: 100,
                uuid: 'test-uuid',
                username: 'testuser',
                name: 'Test User',
                bio: 'Test bio',
                url: new URL('https://example.com/users/testuser'),
                avatarUrl: null,
                bannerImageUrl: null,
                apId: new URL('https://example.com/users/testuser'),
                apFollowers: null,
                apInbox: null,
                isInternal: true,
                customFields: null,
            });

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => {
                const site = c.get('site');
                const account = c.get('account');
                return c.json({ site, account });
            });

            const res = await app.request('/test', {
                headers: {
                    Host: 'example.com',
                },
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.site).toEqual(mockSite);
            expect(json.account).toMatchObject({
                id: 100,
                username: 'testuser',
                name: 'Test User',
            });
        });

        it('should call next() and allow request to continue when authentication succeeds', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            const mockSite = {
                id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
            };

            const mockAccount = AccountEntity.create({
                id: 100,
                uuid: 'test-uuid',
                username: 'testuser',
                name: 'Test User',
                bio: 'Test bio',
                url: new URL('https://example.com/users/testuser'),
                avatarUrl: null,
                bannerImageUrl: null,
                apId: new URL('https://example.com/users/testuser'),
                apFollowers: null,
                apInbox: null,
                isInternal: true,
                customFields: null,
            });

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('success'));

            const res = await app.request('/test', {
                headers: {
                    Host: 'example.com',
                },
            });

            expect(res.status).toBe(200);
            const text = await res.text();
            expect(text).toBe('success');
        });

        it('should log info when no Host header is provided', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();
            const mockContextLogger = {
                info: vi.fn(),
                error: vi.fn(),
            } as unknown as Logger;

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'missing-host',
                    message: 'No Host header provided',
                }),
            );

            app.use((ctx, next) => {
                ctx.set('logger', mockContextLogger);
                return middleware.handle(ctx, next);
            });
            app.get('/test', (c) => c.text('ok'));

            await app.request('/test', {
                headers: {},
            });

            expect(mockContextLogger.info).toHaveBeenCalledWith('No Host header');
        });

        it('should log info when site is not found', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();
            const mockContextLogger = {
                info: vi.fn(),
                error: vi.fn(),
            } as unknown as Logger;

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'site-not-found',
                    host: 'unknown.example.com',
                }),
            );

            app.use((ctx, next) => {
                ctx.set('logger', mockContextLogger);
                return middleware.handle(ctx, next);
            });
            app.get('/test', (c) => c.text('ok'));

            await app.request('/test', {
                headers: {
                    Host: 'unknown.example.com',
                },
            });

            expect(mockContextLogger.info).toHaveBeenCalledWith(
                'No site found for {host}',
                { host: 'unknown.example.com' },
            );
        });

        it('should log error when account is not found', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();
            const mockContextLogger = {
                info: vi.fn(),
                error: vi.fn(),
            } as unknown as Logger;

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'account-not-found',
                    siteId: 1,
                    host: 'example.com',
                }),
            );

            app.use((ctx, next) => {
                ctx.set('logger', mockContextLogger);
                return middleware.handle(ctx, next);
            });
            app.get('/test', (c) => c.text('ok'));

            await app.request('/test', {
                headers: {
                    Host: 'example.com',
                },
            });

            expect(mockContextLogger.error).toHaveBeenCalledWith(
                'No account found for {host}',
                { host: 'example.com' },
            );
        });

        it('should use fallback logger when context logger is not available', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'missing-host',
                    message: 'No Host header provided',
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('ok'));

            await app.request('/test', {
                headers: {},
            });

            expect(mockLogger.info).toHaveBeenCalledWith('No Host header');
        });

        it('should pass Host header value to SiteAccountView', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'site-not-found',
                    host: 'test.example.com',
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('ok'));

            await app.request('/test', {
                headers: {
                    Host: 'test.example.com',
                },
            });

            expect(mockSiteAccountView.getBySiteHost).toHaveBeenCalledWith(
                'test.example.com',
            );
        });

        it('should handle case-insensitive host headers', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            const mockSite = {
                id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
            };

            const mockAccount = AccountEntity.create({
                id: 100,
                uuid: 'test-uuid',
                username: 'testuser',
                name: 'Test User',
                bio: 'Test bio',
                url: new URL('https://example.com/users/testuser'),
                avatarUrl: null,
                bannerImageUrl: null,
                apId: new URL('https://example.com/users/testuser'),
                apFollowers: null,
                apInbox: null,
                isInternal: true,
                customFields: null,
            });

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('ok'));

            const res = await app.request('/test', {
                headers: {
                    host: 'example.com', // lowercase
                },
            });

            expect(res.status).toBe(200);
            expect(mockSiteAccountView.getBySiteHost).toHaveBeenCalledWith(
                'example.com',
            );
        });

        it('should return JSON response with correct Content-Type for site-not-found error', async () => {
            const app = new Hono<{ Variables: TestContextVariables }>();

            (mockSiteAccountView.getBySiteHost as ReturnType<typeof vi.fn>).mockResolvedValue(
                error({
                    type: 'site-not-found',
                    host: 'unknown.example.com',
                }),
            );

            app.use((ctx, next) => middleware.handle(ctx, next));
            app.get('/test', (c) => c.text('ok'));

            const res = await app.request('/test', {
                headers: {
                    Host: 'unknown.example.com',
                },
            });

            expect(res.headers.get('Content-Type')).toContain(
                'application/json',
            );
        });
    });
});
