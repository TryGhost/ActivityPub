import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    Announce,
    Article,
    Create,
    Note,
    RequestContext,
} from '@fedify/fedify';

import type { Account, AccountEntity } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { FedifyRequestContext } from '@/app';
import {
    ACTIVITYPUB_COLLECTION_PAGE_SIZE,
    ACTOR_DEFAULT_HANDLE,
} from '@/constants';
import { error, ok } from '@/core/result';
import {
    actorDispatcher,
    createOutboxCounter,
    createOutboxDispatcher,
    likedDispatcher,
    nodeInfoDispatcher,
} from '@/dispatchers';
import {
    buildAnnounceActivityForPost,
    buildCreateActivityAndObjectFromPost,
} from '@/helpers/activitypub/activity';
import type { HostDataContextLoader } from '@/http/host-data-context-loader';
import { OutboxType, Post, PostType } from '@/post/post.entity';
import type { PostService } from '@/post/post.service';
import type { Site, SiteService } from '@/site/site.service';

vi.mock('@/app', () => ({
    fedify: {
        createContext: vi.fn(),
    },
}));

vi.mock('@/helpers/activitypub/activity', () => ({
    buildCreateActivityAndObjectFromPost: vi.fn(),
    buildAnnounceActivityForPost: vi.fn(),
}));

describe('dispatchers', () => {
    let mockPost: Post;
    let mockAccount: AccountEntity;
    let mockSite: Site;
    let mockCreateActivity: Create;
    let mockAnnounceActivity: Announce;
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
    } as unknown as FedifyRequestContext;

    const cursor = new Date().toISOString();

    beforeEach(async () => {
        mockAccount = {
            id: 1,
            username: 'testuser',
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

        mockPost = Post.createFromData(mockAccount, {
            type: PostType.Article,
            title: 'Test Post',
            content: 'Test Content',
            apId: new URL('https://example.com/post/123'),
            url: new URL('https://example.com/post/123'),
        });

        vi.clearAllMocks();
        vi.mocked(mockSiteService.getSiteByHost).mockResolvedValue(mockSite);
        vi.mocked(mockAccountService.getAccountForSite).mockResolvedValue(
            mockAccount,
        );
        vi.mocked(mockPostService.getOutboxForAccount).mockResolvedValue({
            items: [{ post: mockPost, type: OutboxType.Original }],
            nextCursor: null,
        });
        vi.mocked(mockPostService.getOutboxItemCount).mockResolvedValue(5);

        mockCreateActivity = {
            id: new URL('https://example.com/create/123'),
            type: 'Create',
        } as unknown as Create;
        mockAnnounceActivity = {
            id: new URL('https://example.com/announce/123'),
            type: 'Announce',
        } as unknown as Announce;

        vi.mocked(buildCreateActivityAndObjectFromPost).mockResolvedValue({
            createActivity: mockCreateActivity,
            fedifyObject: {} as unknown as Note | Article,
        });
        vi.mocked(buildAnnounceActivityForPost).mockResolvedValue(
            mockAnnounceActivity,
        );
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
            } as unknown as FedifyRequestContext;

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
            const nextCursor = new Date().toISOString();
            vi.mocked(mockPostService.getOutboxForAccount).mockResolvedValue({
                items: [
                    { post: mockPost, type: OutboxType.Original },
                    { post: mockPost, type: OutboxType.Original },
                ],
                nextCursor: nextCursor,
            });
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', cursor);

            expect(mockSiteService.getSiteByHost).toHaveBeenCalledWith(
                'example.com',
            );
            expect(mockAccountService.getAccountForSite).toHaveBeenCalledWith(
                mockSite,
            );
            expect(mockPostService.getOutboxForAccount).toHaveBeenCalledWith(
                1,
                cursor,
                ACTIVITYPUB_COLLECTION_PAGE_SIZE,
            );
            expect(result.items).toBeDefined();
            expect(result.nextCursor).toBe(nextCursor);
        });

        it('returns null nextCursor when no more items', async () => {
            vi.mocked(mockPostService.getOutboxItemCount).mockResolvedValue(1);
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', cursor);

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
            vi.mocked(mockPostService.getOutboxForAccount).mockResolvedValue({
                items: [],
                nextCursor: null,
            });
            vi.mocked(mockPostService.getOutboxItemCount).mockResolvedValue(0);
            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', cursor);

            expect(result.items).toEqual([]);
            expect(result.nextCursor).toBeNull();
        });

        it('returns create activity for original posts', async () => {
            const author = Post.createFromData(mockAccount, {
                type: PostType.Article,
                title: 'Test Post by Same Author',
                content: 'Test Content',
                apId: new URL('https://example.com/post/456'),
                url: new URL('https://example.com/post/456'),
            });

            vi.mocked(mockPostService.getOutboxForAccount).mockResolvedValue({
                items: [{ post: author, type: OutboxType.Original }],
                nextCursor: null,
            });

            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', cursor);

            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toBe(mockCreateActivity);
            expect(buildCreateActivityAndObjectFromPost).toHaveBeenCalledWith(
                author,
                ctx,
            );
        });

        it('returns announce activity for reposts', async () => {
            const differentAuthor = {
                id: 2,
                username: 'differentuser',
                apId: new URL('https://example.com/user/differentuser'),
                apInbox: new URL(
                    'https://example.com/user/differentuser/inbox',
                ),
                isInternal: false,
            } as AccountEntity;

            // Create a post where the author is different from the site default account
            const postWithDifferentAuthor = Post.createFromData(
                differentAuthor,
                {
                    type: PostType.Article,
                    title: 'Test Post by Different Author',
                    content: 'Test Content',
                    apId: new URL('https://example.com/post/789'),
                    url: new URL('https://example.com/post/789'),
                },
            );

            vi.mocked(mockPostService.getOutboxForAccount).mockResolvedValue({
                items: [
                    { post: postWithDifferentAuthor, type: OutboxType.Repost },
                ],
                nextCursor: null,
            });

            const outboxDispatcher = createOutboxDispatcher(
                mockAccountService,
                mockPostService,
                mockSiteService,
            );

            const result = await outboxDispatcher(ctx, 'test-handle', cursor);

            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toBe(mockAnnounceActivity);
            expect(buildAnnounceActivityForPost).toHaveBeenCalledWith(
                mockAccount,
                postWithDifferentAuthor,
                ctx,
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

    describe('actorDispatcher', () => {
        const mockHostDataContextLoader = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockAccountForActor: Account = {
            id: 1,
            uuid: 'test-uuid',
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: new URL('https://example.com/user/testuser'),
            avatarUrl: new URL('https://example.com/avatar.jpg'),
            bannerImageUrl: new URL('https://example.com/banner.jpg'),
            apId: new URL('https://example.com/user/testuser'),
            apInbox: new URL('https://example.com/user/testuser/inbox'),
            apOutbox: new URL('https://example.com/user/testuser/outbox'),
            apFollowing: new URL('https://example.com/user/testuser/following'),
            apFollowers: new URL('https://example.com/user/testuser/followers'),
            apLiked: new URL('https://example.com/user/testuser/liked'),
            isInternal: true,
            customFields: null,
        } as Account;

        let actorCtx: FedifyRequestContext;

        beforeEach(() => {
            actorCtx = {
                data: {
                    logger: {
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
                getActorKeyPairs: vi.fn().mockResolvedValue([]),
            } as unknown as FedifyRequestContext;
        });

        it('returns a Person when host data is found', async () => {
            vi.mocked(
                mockHostDataContextLoader.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForActor,
                }),
            );

            const dispatcher = actorDispatcher(mockHostDataContextLoader);
            const result = await dispatcher(actorCtx, 'testuser');

            expect(result).not.toBeNull();
            expect(result?.id?.href).toBe('https://example.com/user/testuser');
            expect(result?.name?.toString()).toBe('Test User');
            expect(result?.preferredUsername?.toString()).toBe('testuser');
            expect(result?.summary?.toString()).toBe('Test bio');
            expect(
                mockHostDataContextLoader.loadDataForHost,
            ).toHaveBeenCalledWith('example.com');
        });

        it('returns a Person without icon when avatarUrl is null', async () => {
            const accountWithoutAvatar = {
                ...mockAccountForActor,
                avatarUrl: null,
            } as Account;

            vi.mocked(
                mockHostDataContextLoader.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: accountWithoutAvatar,
                }),
            );

            const dispatcher = actorDispatcher(mockHostDataContextLoader);
            const result = await dispatcher(actorCtx, 'testuser');

            expect(result).not.toBeNull();
            expect(result?.iconId).toBeNull();
        });

        it('returns a Person without image when bannerImageUrl is null', async () => {
            const accountWithoutBanner = {
                ...mockAccountForActor,
                bannerImageUrl: null,
            } as Account;

            vi.mocked(
                mockHostDataContextLoader.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: accountWithoutBanner,
                }),
            );

            const dispatcher = actorDispatcher(mockHostDataContextLoader);
            const result = await dispatcher(actorCtx, 'testuser');

            expect(result).not.toBeNull();
            expect(result?.imageId).toBeNull();
        });

        it('returns null when site is not found', async () => {
            vi.mocked(
                mockHostDataContextLoader.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const dispatcher = actorDispatcher(mockHostDataContextLoader);
            const result = await dispatcher(actorCtx, 'testuser');

            expect(result).toBeNull();
        });

        it('returns null when account is not found', async () => {
            vi.mocked(
                mockHostDataContextLoader.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const dispatcher = actorDispatcher(mockHostDataContextLoader);
            const result = await dispatcher(actorCtx, 'testuser');

            expect(result).toBeNull();
        });

        it('returns null when multiple users are found for the site', async () => {
            vi.mocked(
                mockHostDataContextLoader.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const dispatcher = actorDispatcher(mockHostDataContextLoader);
            const result = await dispatcher(actorCtx, 'testuser');

            expect(result).toBeNull();
            expect(actorCtx.data.logger.info).toHaveBeenCalledWith(
                'Multiple users found for {host}',
                { host: 'example.com' },
            );
        });
    });
});
