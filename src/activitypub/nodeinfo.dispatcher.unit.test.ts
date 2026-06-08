import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountEntity } from '@/account/account.entity';
import { NodeInfoDispatcher } from '@/activitypub/nodeinfo.dispatcher';
import type { NodeInfoService } from '@/activitypub/nodeinfo.service';
import type { FedifyRequestContext } from '@/app';
import { error, ok } from '@/core/result';
import type { HostDataContextLoader } from '@/http/host-data-context-loader';
import type { Site } from '@/site/site.service';

describe('NodeInfoDispatcher', () => {
    let mockAccount: AccountEntity;
    let mockSite: Site;

    beforeEach(() => {
        mockAccount = {
            id: 1,
            username: 'testuser',
            name: 'Test Site',
            bio: 'Test description',
            url: new URL('https://example.com/'),
            avatarUrl: new URL('https://example.com/icon.png'),
            bannerImageUrl: new URL('https://example.com/banner.png'),
            apId: new URL('https://example.com/user/testuser'),
            apInbox: new URL('https://example.com/user/testuser/inbox'),
            isInternal: true,
        } as AccountEntity;

        mockSite = {
            id: 1,
            host: 'example.com',
            webhook_secret: 'test-secret',
            ghost_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
        } as Site;

        vi.clearAllMocks();
    });

    it('resolves host data and returns node info', async () => {
        const hostDataContextLoader = {
            loadDataForHost: vi.fn().mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            ),
        };
        const nodeInfoService = {
            getData: vi.fn().mockResolvedValue({
                lastActivityAt: new Date(),
                localPosts: 2,
                localComments: 1,
            }),
        };

        const dispatcher = new NodeInfoDispatcher(
            hostDataContextLoader as unknown as HostDataContextLoader,
            nodeInfoService as unknown as NodeInfoService,
        );

        const result = await dispatcher.dispatch({
            host: mockSite.host,
            data: {
                logger: {
                    error: vi.fn(),
                },
            },
        } as unknown as FedifyRequestContext);

        expect(result.usage.users.total).toBe(1);
        expect(result.usage.users.activeMonth).toBe(1);
        expect(result.usage.users.activeHalfyear).toBe(1);
        expect(result.usage.localPosts).toBe(2);
        expect(result.usage.localComments).toBe(1);
        expect(result.metadata).toEqual({
            nodeName: mockAccount.name,
            nodeDescription: mockAccount.bio,
            nodeIcon: mockAccount.avatarUrl?.href,
            nodeBanner: mockAccount.bannerImageUrl?.href,
            private: false,
            postFormats: ['text/html'],
        });
        expect(hostDataContextLoader.loadDataForHost).toHaveBeenCalledWith(
            mockSite.host,
        );
        expect(nodeInfoService.getData).toHaveBeenCalledWith(
            mockSite,
            mockAccount,
        );
    });

    it('maps last activity into active user windows', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        const daysAgo = (days: number) =>
            new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        vi.useFakeTimers();
        vi.setSystemTime(now);

        try {
            const cases = [
                {
                    lastActivityAt: null,
                    activeMonth: 0,
                    activeHalfyear: 0,
                },
                {
                    lastActivityAt: daysAgo(30),
                    activeMonth: 1,
                    activeHalfyear: 1,
                },
                {
                    lastActivityAt: daysAgo(31),
                    activeMonth: 0,
                    activeHalfyear: 1,
                },
                {
                    lastActivityAt: daysAgo(180),
                    activeMonth: 0,
                    activeHalfyear: 1,
                },
                {
                    lastActivityAt: daysAgo(181),
                    activeMonth: 0,
                    activeHalfyear: 0,
                },
            ];

            for (const {
                lastActivityAt,
                activeMonth,
                activeHalfyear,
            } of cases) {
                const hostDataContextLoader = {
                    loadDataForHost: vi.fn().mockResolvedValue(
                        ok({
                            site: mockSite,
                            account: mockAccount,
                        }),
                    ),
                };
                const nodeInfoService = {
                    getData: vi.fn().mockResolvedValue({
                        lastActivityAt,
                        localPosts: 0,
                        localComments: 0,
                    }),
                };

                const dispatcher = new NodeInfoDispatcher(
                    hostDataContextLoader as unknown as HostDataContextLoader,
                    nodeInfoService as unknown as NodeInfoService,
                );

                const result = await dispatcher.dispatch({
                    host: mockSite.host,
                    data: {
                        logger: {
                            error: vi.fn(),
                        },
                    },
                } as unknown as FedifyRequestContext);

                expect(result.usage.users.activeMonth).toBe(activeMonth);
                expect(result.usage.users.activeHalfyear).toBe(activeHalfyear);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it('throws when host data cannot be resolved', async () => {
        const logger = {
            error: vi.fn(),
        };
        const hostDataContextLoader = {
            loadDataForHost: vi.fn().mockResolvedValue(error('site-not-found')),
        };
        const nodeInfoService = {
            getData: vi.fn(),
        };

        const dispatcher = new NodeInfoDispatcher(
            hostDataContextLoader as unknown as HostDataContextLoader,
            nodeInfoService as unknown as NodeInfoService,
        );

        await expect(
            dispatcher.dispatch({
                host: mockSite.host,
                data: { logger },
            } as unknown as FedifyRequestContext),
        ).rejects.toThrow('NodeInfo requested without site context');
        expect(nodeInfoService.getData).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
            'NodeInfo: failed to resolve host',
            {
                host: mockSite.host,
                error: 'site-not-found',
            },
        );
    });
});
