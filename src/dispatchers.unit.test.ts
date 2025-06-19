import type { RequestContext } from '@fedify/fedify';
import {
    createOutboxCounter,
    createOutboxDispatcher,
    likedDispatcher,
    nodeInfoDispatcher,
} from './dispatchers';

import type { ContextData } from 'app';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountEntity } from './account/account.entity';
import type { AccountService } from './account/account.service';
import type { Account } from './account/types';
import { ACTOR_DEFAULT_HANDLE } from './constants';
import { Post, PostType } from './post/post.entity';
import type { PostService } from './post/post.service';
import type { Site, SiteService } from './site/site.service';

vi.mock('./app', () => ({
    fedify: {
        createContext: vi.fn(),
    },
}));

describe('dispatchers', () => {
    let mockPost: Post;
    let mockAccount: Account;
    let mockSite: Site;
    const mockPostService = {
        getOutboxForAccount: vi.fn(),
        getOutboxItemCount: vi.fn(),
    } as unknown as PostService;

    const mockAccountService = {
        getAccountForSite: vi.fn(),
    } as unknown as AccountService;

    const mockSiteService = {
        getSiteByHost: vi.fn(),
    } as unknown as SiteService;

    const ctx = {
        data: {
            logger: {
                info: vi.fn(),
                error: vi.fn(),
            },
        },
        request: {
            headers: {
                get: vi.fn().mockReturnValue('example.com'),
            },
        },
        getObjectUri: vi.fn(),
        host: 'example.com',
    } as unknown as RequestContext<ContextData>;

    beforeEach(async () => {
        mockAccount = {
            id: 1,
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: null,
            avatar_url: 'http://example.com/avatar.jpg',
            banner_image_url: null,
            ap_id: 'https://example.com/user/testuser',
            ap_inbox_url: 'https://example.com/user/testuser/inbox',
            ap_shared_inbox_url: null,
            ap_outbox_url: 'https://example.com/user/testuser/outbox',
            ap_following_url: 'https://example.com/user/testuser/following',
            ap_followers_url: 'https://example.com/user/testuser/followers',
            ap_liked_url: 'https://example.com/user/testuser/liked',
            ap_public_key: 'mock-public-key',
            ap_private_key: null,
            custom_fields: null,
        };

        mockSite = {
            id: 1,
            host: 'example.com',
            webhook_secret: 'test-secret',
        } as unknown as Site;

        mockPost = Post.createFromData(
            mockAccount as unknown as AccountEntity,
            {
                type: PostType.Article,
                title: 'Test Post',
                content: 'Test Content',
                apId: new URL('https://example.com/post/123'),
                url: new URL('https://example.com/post/123'),
            },
        );

        vi.clearAllMocks();
        process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE = '2';
        vi.mocked(mockSiteService.getSiteByHost).mockResolvedValue(mockSite);
        vi.mocked(mockAccountService.getAccountForSite).mockResolvedValue(
            mockAccount,
        );
        vi.mocked(mockPostService.getOutboxForAccount).mockResolvedValue([
            mockPost,
        ]);
        vi.mocked(mockPostService.getOutboxItemCount).mockResolvedValue(5);
    });

    describe('likedDispatcher', () => {
        it('returns an empty array', async () => {
            const ctx = {
                getObjectUri(_type: unknown, data: Record<string, string>) {
                    return new URL(`https://site.com/${data.id}`);
                },
                data: {
                    globaldb: {
                        get() {
                            return {};
                        },
                    },
                },
            } as unknown as RequestContext<ContextData>;

            const result = await likedDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                null,
            );

            expect(result.items).toEqual([]);
            expect(result.nextCursor).toEqual(null);
        });
    });

    describe('outboxDispatcher', () => {
        it('returns outbox items with pagination', async () => {
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', '0');

            expect(mockSiteService.getSiteByHost).toHaveBeenCalledWith(
                'example.com',
            );
            expect(mockAccountService.getAccountForSite).toHaveBeenCalledWith(
                mockSite,
            );
            expect(mockPostService.getOutboxForAccount).toHaveBeenCalledWith(
                1,
                '0',
                2,
            );
            expect(mockPostService.getOutboxItemCount).toHaveBeenCalledWith(1);
            expect(result.items).toBeDefined();
            expect(result.nextCursor).toBe('2');
        });

        it('returns null nextCursor when no more items', async () => {
            vi.mocked(mockPostService.getOutboxItemCount).mockResolvedValue(1);
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', '0');

            expect(result.nextCursor).toBeNull();
        });

        it('throws error when site not found', async () => {
            vi.mocked(mockSiteService.getSiteByHost).mockResolvedValue(null);
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            await expect(
                outboxDispatcher(ctx, 'test-handle', '0'),
            ).rejects.toThrow('Site not found for host: example.com');
        });

        it('handles empty outbox correctly', async () => {
            vi.mocked(mockPostService.getOutboxForAccount).mockResolvedValue(
                [],
            );
            vi.mocked(mockPostService.getOutboxItemCount).mockResolvedValue(0);
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', '0');

            expect(result.items).toEqual([]);
            expect(result.nextCursor).toBeNull();
        });

        it('handles custom page size from environment variable', async () => {
            process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE = '5';
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            await outboxDispatcher(ctx, 'test-handle', '0');

            expect(mockPostService.getOutboxForAccount).toHaveBeenCalledWith(
                1,
                '0',
                5,
            );
        });
    });

    describe('countOutboxItems', () => {
        it('returns correct count of outbox items', async () => {
            const countOutboxItems = createOutboxCounter(
                mockSiteService,
                mockAccountService,
                mockPostService,
            );

            const result = await countOutboxItems(ctx);

            expect(mockSiteService.getSiteByHost).toHaveBeenCalledWith(
                'example.com',
            );
            expect(mockAccountService.getAccountForSite).toHaveBeenCalledWith(
                mockSite,
            );
            expect(mockPostService.getOutboxItemCount).toHaveBeenCalledWith(1);
            expect(result).toBe(5);
        });

        it('throws error when site not found', async () => {
            vi.mocked(mockSiteService.getSiteByHost).mockResolvedValue(null);
            const countOutboxItems = createOutboxCounter(
                mockSiteService,
                mockAccountService,
                mockPostService,
            );

            await expect(countOutboxItems(ctx)).rejects.toThrow(
                'Site not found for host: example.com',
            );
        });

        it('handles zero count correctly', async () => {
            vi.mocked(mockPostService.getOutboxItemCount).mockResolvedValue(0);
            const countOutboxItems = createOutboxCounter(
                mockSiteService,
                mockAccountService,
                mockPostService,
            );

            const result = await countOutboxItems(ctx);

            expect(result).toBe(0);
        });
    });

    describe('nodeInfoDispatcher', () => {
        it('returns the node info', async () => {
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
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
                    users: {
                        total: 1,
                    },
                    localPosts: 0,
                    localComments: 0,
                },
            });
        });
    });
});
