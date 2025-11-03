import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Knex } from 'knex';

import { getError, getValue, isError } from '@/core/result';
import { SiteAccountView } from '@/http/middleware/site-account.view';

describe('SiteAccountView', () => {
    let view: SiteAccountView;
    let mockDb: Knex;

    beforeEach(() => {
        mockDb = {
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            leftJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
        } as unknown as Knex;

        view = new SiteAccountView(mockDb);
    });

    describe('getBySiteHost', () => {
        it('should return missing-host error when host is undefined', async () => {
            const result = await view.getBySiteHost(undefined);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                const error = getError(result);
                expect(error.type).toBe('missing-host');
                if (error.type === 'missing-host') {
                    expect(error.message).toBe('No Host header provided');
                }
            }
        });

        it('should return site-not-found error when site does not exist', async () => {
            const mockSelect = vi.fn().mockResolvedValue([]);
            mockDb.select = vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    leftJoin: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: mockSelect,
                        }),
                    }),
                }),
            }) as unknown as typeof mockDb.select;

            const result = await view.getBySiteHost('nonexistent.example.com');

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                const error = getError(result);
                expect(error.type).toBe('site-not-found');
                if (error.type === 'site-not-found') {
                    expect(error.host).toBe('nonexistent.example.com');
                }
            }
        });

        it('should return account-not-found error when site exists but has no account', async () => {
            const mockSiteRow = {
                site_id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
                account_id: null,
            };

            const mockSelect = vi.fn().mockResolvedValue([mockSiteRow]);
            mockDb.select = vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    leftJoin: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: mockSelect,
                        }),
                    }),
                }),
            }) as unknown as typeof mockDb.select;

            const result = await view.getBySiteHost('example.com');

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                const error = getError(result);
                expect(error.type).toBe('account-not-found');
                if (error.type === 'account-not-found') {
                    expect(error.siteId).toBe(1);
                    expect(error.host).toBe('example.com');
                }
            }
        });

        it('should return site and account data when both exist', async () => {
            const mockSiteAccountRow = {
                site_id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
                account_id: 100,
                uuid: 'test-uuid-123',
                username: 'testuser',
                name: 'Test User',
                bio: 'Test bio',
                url: 'https://example.com/users/testuser',
                avatar_url: 'https://example.com/avatar.jpg',
                banner_image_url: 'https://example.com/banner.jpg',
                custom_fields: { key: 'value' },
                ap_id: 'https://example.com/users/testuser',
                ap_followers_url: 'https://example.com/users/testuser/followers',
                ap_inbox_url: 'https://example.com/users/testuser/inbox',
            };

            const mockSelect = vi.fn().mockResolvedValue([mockSiteAccountRow]);
            mockDb.select = vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    leftJoin: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: mockSelect,
                        }),
                    }),
                }),
            }) as unknown as typeof mockDb.select;

            const result = await view.getBySiteHost('example.com');

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const data = getValue(result);
                expect(data.site).toEqual({
                    id: 1,
                    host: 'example.com',
                    webhook_secret: 'secret123',
                });
                expect(data.account.id).toBe(100);
                expect(data.account.username).toBe('testuser');
                expect(data.account.name).toBe('Test User');
                expect(data.account.bio).toBe('Test bio');
                expect(data.account.uuid).toBe('test-uuid-123');
            }
        });

        it('should generate and save UUID when account has no UUID', async () => {
            const mockSiteAccountRow = {
                site_id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
                account_id: 100,
                uuid: null,
                username: 'testuser',
                name: 'Test User',
                bio: 'Test bio',
                url: 'https://example.com/users/testuser',
                avatar_url: null,
                banner_image_url: null,
                custom_fields: null,
                ap_id: 'https://example.com/users/testuser',
                ap_followers_url: 'https://example.com/users/testuser/followers',
                ap_inbox_url: 'https://example.com/users/testuser/inbox',
            };

            const mockSelect = vi.fn().mockResolvedValue([mockSiteAccountRow]);
            const mockUpdate = vi.fn().mockResolvedValue(1);

            // Create a callable mock function that also has the select method
            const mockDbCallable = Object.assign(
                vi.fn().mockReturnValue({
                    update: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            andWhere: mockUpdate,
                        }),
                    }),
                }),
                {
                    select: vi.fn().mockReturnValue({
                        from: vi.fn().mockReturnValue({
                            leftJoin: vi.fn().mockReturnValue({
                                leftJoin: vi.fn().mockReturnValue({
                                    where: mockSelect,
                                }),
                            }),
                        }),
                    }),
                },
            );

            // Create a new view instance with the callable mock
            const testView = new SiteAccountView(
                mockDbCallable as unknown as Knex,
            );

            const result = await testView.getBySiteHost('example.com');

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const data = getValue(result);
                // UUID should be generated
                expect(data.account.uuid).toMatch(
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
                );
                // Verify update was called
                expect(mockDbCallable).toHaveBeenCalledWith('accounts');
            }
        });

        it('should handle null URLs gracefully', async () => {
            const mockSiteAccountRow = {
                site_id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
                account_id: 100,
                uuid: 'test-uuid-123',
                username: 'testuser',
                name: 'Test User',
                bio: null,
                url: 'https://example.com/users/testuser',
                avatar_url: null,
                banner_image_url: null,
                custom_fields: null,
                ap_id: 'https://example.com/users/testuser',
                ap_followers_url: null,
                ap_inbox_url: null,
            };

            const mockSelect = vi.fn().mockResolvedValue([mockSiteAccountRow]);
            mockDb.select = vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    leftJoin: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: mockSelect,
                        }),
                    }),
                }),
            }) as unknown as typeof mockDb.select;

            const result = await view.getBySiteHost('example.com');

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const data = getValue(result);
                expect(data.account.avatarUrl).toBeNull();
                expect(data.account.bannerImageUrl).toBeNull();
                expect(data.account.apFollowers).toBeNull();
                expect(data.account.apInbox).toBeNull();
            }
        });

        it('should determine isInternal correctly when site_id is present', async () => {
            const mockSiteAccountRow = {
                site_id: 1,
                host: 'example.com',
                webhook_secret: 'secret123',
                account_id: 100,
                uuid: 'test-uuid-123',
                username: 'testuser',
                name: 'Test User',
                bio: 'Test bio',
                url: 'https://example.com/users/testuser',
                avatar_url: null,
                banner_image_url: null,
                custom_fields: null,
                ap_id: 'https://example.com/users/testuser',
                ap_followers_url: 'https://example.com/users/testuser/followers',
                ap_inbox_url: 'https://example.com/users/testuser/inbox',
            };

            const mockSelect = vi.fn().mockResolvedValue([mockSiteAccountRow]);
            mockDb.select = vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    leftJoin: vi.fn().mockReturnValue({
                        leftJoin: vi.fn().mockReturnValue({
                            where: mockSelect,
                        }),
                    }),
                }),
            }) as unknown as typeof mockDb.select;

            const result = await view.getBySiteHost('example.com');

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const data = getValue(result);
                expect(data.account.isInternal).toBe(true);
            }
        });

        it('should query the correct tables and columns', async () => {
            const mockSelect = vi.fn().mockResolvedValue([]);
            const mockWhere = vi.fn().mockReturnValue(mockSelect);
            const mockLeftJoin2 = vi.fn().mockReturnValue({ where: mockWhere });
            const mockLeftJoin1 = vi.fn().mockReturnValue({
                leftJoin: mockLeftJoin2,
            });
            const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin1 });
            mockDb.select = vi.fn().mockReturnValue({ from: mockFrom });

            await view.getBySiteHost('example.com');

            expect(mockDb.select).toHaveBeenCalledWith(
                'sites.id as site_id',
                'sites.host',
                'sites.webhook_secret',
                'users.account_id',
                'accounts.id as account_id',
                'accounts.uuid',
                'accounts.username',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.url',
                'accounts.custom_fields',
                'accounts.ap_id',
                'accounts.ap_inbox_url',
                'accounts.ap_shared_inbox_url',
                'accounts.ap_outbox_url',
                'accounts.ap_following_url',
                'accounts.ap_followers_url',
                'accounts.ap_liked_url',
                'accounts.ap_public_key',
                'accounts.ap_private_key',
            );
            expect(mockFrom).toHaveBeenCalledWith('sites');
            expect(mockLeftJoin1).toHaveBeenCalledWith(
                'users',
                'sites.id',
                'users.site_id',
            );
            expect(mockLeftJoin2).toHaveBeenCalledWith(
                'accounts',
                'users.account_id',
                'accounts.id',
            );
            expect(mockWhere).toHaveBeenCalledWith('sites.host', 'example.com');
        });
    });
});
