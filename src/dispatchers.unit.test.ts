import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportJwk, type RequestContext } from '@fedify/fedify';

import type { Account, AccountEntity } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { Account as AccountType } from '@/account/types';
import type { FollowersService } from '@/activitypub/followers.service';
import type { FedifyContext, FedifyRequestContext } from '@/app';
import {
    ACTIVITYPUB_COLLECTION_PAGE_SIZE,
    ACTOR_DEFAULT_HANDLE,
} from '@/constants';
import { error, ok } from '@/core/result';
import {
    actorDispatcher,
    createFollowersCounter,
    createFollowersDispatcher,
    createFollowingCounter,
    createFollowingDispatcher,
    createOutboxCounter,
    createOutboxDispatcher,
    keypairDispatcher,
    likedDispatcher,
    nodeInfoDispatcher,
} from '@/dispatchers';
import type { HostDataContextLoader } from '@/http/host-data-context-loader';
import { OutboxType, Post, PostType } from '@/post/post.entity';
import type { PostService } from '@/post/post.service';
import type { Site } from '@/site/site.service';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';

vi.mock('@/app', () => ({
    fedify: {
        createContext: vi.fn(),
    },
}));

describe('dispatchers', () => {
    let mockPost: Post;
    let mockAccount: AccountEntity;
    let mockSite: Site;

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
        const mockHostDataContextLoaderForOutbox = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockPostServiceForOutbox = {
            getOutboxForAccount: vi.fn(),
        } as unknown as PostService;

        let outboxCtx: FedifyRequestContext;

        beforeEach(() => {
            outboxCtx = {
                data: {
                    logger: {
                        debug: vi.fn(),
                        info: vi.fn(),
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
                request: {
                    headers: {
                        get: vi.fn().mockReturnValue('example.com'),
                    },
                },
                getObjectUri: vi
                    .fn()
                    .mockReturnValue(new URL('https://example.com/object/123')),
            } as unknown as FedifyRequestContext;

            vi.mocked(
                mockPostServiceForOutbox.getOutboxForAccount,
            ).mockResolvedValue({
                items: [{ post: mockPost, type: OutboxType.Original }],
                nextCursor: null,
            });
        });

        it('returns outbox items with pagination', async () => {
            const nextCursor = new Date().toISOString();
            vi.mocked(
                mockPostServiceForOutbox.getOutboxForAccount,
            ).mockResolvedValue({
                items: [
                    { post: mockPost, type: OutboxType.Original },
                    { post: mockPost, type: OutboxType.Original },
                ],
                nextCursor: nextCursor,
            });

            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            const result = await dispatcher(outboxCtx, 'test-handle', cursor);

            expect(
                mockPostServiceForOutbox.getOutboxForAccount,
            ).toHaveBeenCalledWith(1, cursor, ACTIVITYPUB_COLLECTION_PAGE_SIZE);
            expect(result.items).toBeDefined();
            expect(result.nextCursor).toBe(nextCursor);
        });

        it('throws error when site not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            await expect(
                dispatcher(outboxCtx, 'test-handle', cursor),
            ).rejects.toThrow('Site not found for host: example.com');
        });

        it('throws error when account not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            await expect(
                dispatcher(outboxCtx, 'test-handle', cursor),
            ).rejects.toThrow('Account not found for host: example.com');
        });

        it('throws error when multiple users found for site', async () => {
            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            await expect(
                dispatcher(outboxCtx, 'test-handle', cursor),
            ).rejects.toThrow('Multiple users found for host: example.com');
        });

        it('returns null nextCursor when no more items', async () => {
            vi.mocked(
                mockPostServiceForOutbox.getOutboxForAccount,
            ).mockResolvedValue({
                items: [{ post: mockPost, type: OutboxType.Original }],
                nextCursor: null,
            });

            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            const result = await dispatcher(outboxCtx, 'test-handle', cursor);

            expect(result.nextCursor).toBeNull();
        });

        it('handles empty outbox correctly', async () => {
            vi.mocked(
                mockPostServiceForOutbox.getOutboxForAccount,
            ).mockResolvedValue({
                items: [],
                nextCursor: null,
            });

            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            const result = await dispatcher(outboxCtx, 'test-handle', cursor);

            expect(result.items).toEqual([]);
            expect(result.nextCursor).toBeNull();
        });

        it('returns create activity for original posts', async () => {
            const originalPost = Post.createFromData(mockAccount, {
                type: PostType.Article,
                title: 'Test Post by Same Author',
                content: 'Test Content',
                apId: new URL('https://example.com/post/456'),
                url: new URL('https://example.com/post/456'),
            });

            vi.mocked(
                mockPostServiceForOutbox.getOutboxForAccount,
            ).mockResolvedValue({
                items: [{ post: originalPost, type: OutboxType.Original }],
                nextCursor: null,
            });

            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            const result = await dispatcher(outboxCtx, 'test-handle', cursor);

            expect(result.items).toHaveLength(1);
            // The result should be a Create activity
            expect(result.items[0]).toBeDefined();
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

            vi.mocked(
                mockPostServiceForOutbox.getOutboxForAccount,
            ).mockResolvedValue({
                items: [
                    { post: postWithDifferentAuthor, type: OutboxType.Repost },
                ],
                nextCursor: null,
            });

            vi.mocked(
                mockHostDataContextLoaderForOutbox.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            const dispatcher = createOutboxDispatcher(
                mockPostServiceForOutbox,
                mockHostDataContextLoaderForOutbox,
            );

            const result = await dispatcher(outboxCtx, 'test-handle', cursor);

            expect(result.items).toHaveLength(1);
            // The result should be an Announce activity
            expect(result.items[0]).toBeDefined();
        });
    });

    describe('countOutboxItems', () => {
        const mockHostDataContextLoaderForOutboxCounter = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockPostServiceForOutboxCounter = {
            getOutboxItemCount: vi.fn(),
        } as unknown as PostService;

        let outboxCounterCtx: FedifyRequestContext;

        beforeEach(() => {
            outboxCounterCtx = {
                data: {
                    logger: {
                        info: vi.fn(),
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
            } as unknown as FedifyRequestContext;

            vi.mocked(
                mockPostServiceForOutboxCounter.getOutboxItemCount,
            ).mockResolvedValue(5);
        });

        it('returns correct count of outbox items', async () => {
            vi.mocked(
                mockHostDataContextLoaderForOutboxCounter.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            const countOutboxItems = createOutboxCounter(
                mockPostServiceForOutboxCounter,
                mockHostDataContextLoaderForOutboxCounter,
            );

            const result = await countOutboxItems(outboxCounterCtx);

            expect(
                mockPostServiceForOutboxCounter.getOutboxItemCount,
            ).toHaveBeenCalledWith(1);
            expect(result).toBe(5);
        });

        it('throws error when site not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForOutboxCounter.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const countOutboxItems = createOutboxCounter(
                mockPostServiceForOutboxCounter,
                mockHostDataContextLoaderForOutboxCounter,
            );

            await expect(countOutboxItems(outboxCounterCtx)).rejects.toThrow(
                'Site not found for host: example.com',
            );
        });

        it('throws error when account not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForOutboxCounter.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const countOutboxItems = createOutboxCounter(
                mockPostServiceForOutboxCounter,
                mockHostDataContextLoaderForOutboxCounter,
            );

            await expect(countOutboxItems(outboxCounterCtx)).rejects.toThrow(
                'Account not found for host: example.com',
            );
        });

        it('throws error when multiple users found for site', async () => {
            vi.mocked(
                mockHostDataContextLoaderForOutboxCounter.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const countOutboxItems = createOutboxCounter(
                mockPostServiceForOutboxCounter,
                mockHostDataContextLoaderForOutboxCounter,
            );

            await expect(countOutboxItems(outboxCounterCtx)).rejects.toThrow(
                'Multiple users found for host: example.com',
            );
        });

        it('handles zero count correctly', async () => {
            vi.mocked(
                mockPostServiceForOutboxCounter.getOutboxItemCount,
            ).mockResolvedValue(0);

            vi.mocked(
                mockHostDataContextLoaderForOutboxCounter.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccount,
                }),
            );

            const countOutboxItems = createOutboxCounter(
                mockPostServiceForOutboxCounter,
                mockHostDataContextLoaderForOutboxCounter,
            );

            const result = await countOutboxItems(outboxCounterCtx);

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

        it('returns a Person', async () => {
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
        });
    });

    describe('keypairDispatcher', () => {
        const mockHostDataContextLoaderForKeypair = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockAccountServiceForKeypair = {
            getKeyPair: vi.fn(),
        } as unknown as AccountService;

        const mockAccountForKeypair: Account = {
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

        let keypairCtx: FedifyContext;

        beforeEach(() => {
            keypairCtx = {
                data: {
                    logger: {
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
            } as unknown as FedifyContext;
        });

        it('returns empty array when site is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForKeypair.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const dispatcher = keypairDispatcher(
                mockAccountServiceForKeypair,
                mockHostDataContextLoaderForKeypair,
            );
            const result = await dispatcher(keypairCtx, 'testuser');

            expect(result).toEqual([]);
        });

        it('returns empty array when account is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForKeypair.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const dispatcher = keypairDispatcher(
                mockAccountServiceForKeypair,
                mockHostDataContextLoaderForKeypair,
            );
            const result = await dispatcher(keypairCtx, 'testuser');

            expect(result).toEqual([]);
        });

        it('returns empty array when multiple users are found for the site', async () => {
            vi.mocked(
                mockHostDataContextLoaderForKeypair.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const dispatcher = keypairDispatcher(
                mockAccountServiceForKeypair,
                mockHostDataContextLoaderForKeypair,
            );
            const result = await dispatcher(keypairCtx, 'testuser');

            expect(result).toEqual([]);
        });

        it('returns empty array when key pair is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForKeypair.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForKeypair,
                }),
            );
            vi.mocked(
                mockAccountServiceForKeypair.getKeyPair,
            ).mockResolvedValue(error('key-pair-not-found'));

            const dispatcher = keypairDispatcher(
                mockAccountServiceForKeypair,
                mockHostDataContextLoaderForKeypair,
            );
            const result = await dispatcher(keypairCtx, 'testuser');

            expect(result).toEqual([]);
        });

        it('returns empty array when parsing keypair throws an error', async () => {
            vi.mocked(
                mockHostDataContextLoaderForKeypair.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForKeypair,
                }),
            );
            vi.mocked(
                mockAccountServiceForKeypair.getKeyPair,
            ).mockResolvedValue(
                ok({
                    publicKey: 'invalid-json',
                    privateKey: 'invalid-json',
                }),
            );

            const dispatcher = keypairDispatcher(
                mockAccountServiceForKeypair,
                mockHostDataContextLoaderForKeypair,
            );
            const result = await dispatcher(keypairCtx, 'testuser');

            expect(result).toEqual([]);
        });

        it('returns keypair when host data and keys are found', async () => {
            const keyPair = await generateTestCryptoKeyPair();
            const publicKeyJwk = JSON.stringify(
                await exportJwk(keyPair.publicKey),
            );
            const privateKeyJwk = JSON.stringify(
                await exportJwk(keyPair.privateKey),
            );

            vi.mocked(
                mockHostDataContextLoaderForKeypair.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForKeypair,
                }),
            );
            vi.mocked(
                mockAccountServiceForKeypair.getKeyPair,
            ).mockResolvedValue(
                ok({
                    publicKey: publicKeyJwk,
                    privateKey: privateKeyJwk,
                }),
            );

            const dispatcher = keypairDispatcher(
                mockAccountServiceForKeypair,
                mockHostDataContextLoaderForKeypair,
            );
            const result = await dispatcher(keypairCtx, 'testuser');

            expect(result).toHaveLength(1);
            expect(result[0].publicKey).toBeInstanceOf(CryptoKey);
            expect(result[0].privateKey).toBeInstanceOf(CryptoKey);
        });
    });

    describe('createFollowersDispatcher', () => {
        const mockHostDataContextLoaderForFollowers = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockFollowersService = {
            getFollowers: vi.fn(),
        } as unknown as FollowersService;

        const mockAccountForFollowers: Account = {
            id: 1,
            uuid: 'test-uuid',
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: new URL('https://example.com/user/testuser'),
            avatarUrl: null,
            bannerImageUrl: null,
            apId: new URL('https://example.com/user/testuser'),
            apInbox: new URL('https://example.com/user/testuser/inbox'),
            apOutbox: new URL('https://example.com/user/testuser/outbox'),
            apFollowing: new URL('https://example.com/user/testuser/following'),
            apFollowers: new URL('https://example.com/user/testuser/followers'),
            apLiked: new URL('https://example.com/user/testuser/liked'),
            isInternal: true,
            customFields: null,
        } as Account;

        let followersCtx: FedifyContext;

        beforeEach(() => {
            followersCtx = {
                data: {
                    logger: {
                        info: vi.fn(),
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
            } as unknown as FedifyContext;
        });

        it('returns followers', async () => {
            const mockFollowers = [
                {
                    id: new URL('https://remote.com/user/follower1'),
                    inboxId: new URL('https://remote.com/user/follower1/inbox'),
                    endpoints: { sharedInbox: null },
                },
            ];

            vi.mocked(
                mockHostDataContextLoaderForFollowers.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForFollowers,
                }),
            );
            vi.mocked(mockFollowersService.getFollowers).mockResolvedValue(
                mockFollowers,
            );

            const dispatcher = createFollowersDispatcher(
                mockFollowersService,
                mockHostDataContextLoaderForFollowers,
            );
            const result = await dispatcher(followersCtx, 'testuser');

            expect(result).toEqual({ items: mockFollowers });
            expect(mockFollowersService.getFollowers).toHaveBeenCalledWith(1);
        });

        it('throws error when site is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowers.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const dispatcher = createFollowersDispatcher(
                mockFollowersService,
                mockHostDataContextLoaderForFollowers,
            );

            await expect(dispatcher(followersCtx, 'testuser')).rejects.toThrow(
                'Site not found for host: example.com',
            );
        });

        it('throws error when account is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowers.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const dispatcher = createFollowersDispatcher(
                mockFollowersService,
                mockHostDataContextLoaderForFollowers,
            );

            await expect(dispatcher(followersCtx, 'testuser')).rejects.toThrow(
                'Account not found for host: example.com',
            );
        });

        it('throws error when multiple users are found for the site', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowers.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const dispatcher = createFollowersDispatcher(
                mockFollowersService,
                mockHostDataContextLoaderForFollowers,
            );

            await expect(dispatcher(followersCtx, 'testuser')).rejects.toThrow(
                'Multiple users found for host: example.com',
            );
        });
    });

    describe('createFollowingDispatcher', () => {
        const mockHostDataContextLoaderForFollowing = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockAccountServiceForFollowing = {
            getFollowingAccounts: vi.fn(),
            getFollowingAccountsCount: vi.fn(),
        } as unknown as AccountService;

        const mockAccountForFollowing: Account = {
            id: 1,
            uuid: 'test-uuid',
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: new URL('https://example.com/user/testuser'),
            avatarUrl: null,
            bannerImageUrl: null,
            apId: new URL('https://example.com/user/testuser'),
            apInbox: new URL('https://example.com/user/testuser/inbox'),
            apOutbox: new URL('https://example.com/user/testuser/outbox'),
            apFollowing: new URL('https://example.com/user/testuser/following'),
            apFollowers: new URL('https://example.com/user/testuser/followers'),
            apLiked: new URL('https://example.com/user/testuser/liked'),
            isInternal: true,
            customFields: null,
        } as Account;

        let followingCtx: FedifyRequestContext;

        beforeEach(() => {
            followingCtx = {
                data: {
                    logger: {
                        debug: vi.fn(),
                        info: vi.fn(),
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
                request: {
                    headers: {
                        get: vi.fn().mockReturnValue('example.com'),
                    },
                },
            } as unknown as FedifyRequestContext;
        });

        it('returns following accounts', async () => {
            const mockFollowing = [
                { ap_id: 'https://remote.com/user/following1' },
                { ap_id: 'https://remote.com/user/following2' },
            ] as unknown as AccountType[];

            vi.mocked(
                mockHostDataContextLoaderForFollowing.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForFollowing,
                }),
            );
            vi.mocked(
                mockAccountServiceForFollowing.getFollowingAccounts,
            ).mockResolvedValue(mockFollowing);
            vi.mocked(
                mockAccountServiceForFollowing.getFollowingAccountsCount,
            ).mockResolvedValue(2);

            const dispatcher = createFollowingDispatcher(
                mockAccountServiceForFollowing,
                mockHostDataContextLoaderForFollowing,
            );
            const result = await dispatcher(followingCtx, 'testuser', '0');

            expect(result.items).toHaveLength(2);
            expect(result.items[0].href).toBe(
                'https://remote.com/user/following1',
            );
            expect(result.items[1].href).toBe(
                'https://remote.com/user/following2',
            );
        });

        it('throws error when site is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowing.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const dispatcher = createFollowingDispatcher(
                mockAccountServiceForFollowing,
                mockHostDataContextLoaderForFollowing,
            );

            await expect(
                dispatcher(followingCtx, 'testuser', '0'),
            ).rejects.toThrow('Site not found for host: example.com');
        });

        it('throws error when account is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowing.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const dispatcher = createFollowingDispatcher(
                mockAccountServiceForFollowing,
                mockHostDataContextLoaderForFollowing,
            );

            await expect(
                dispatcher(followingCtx, 'testuser', '0'),
            ).rejects.toThrow('Account not found for host: example.com');
        });

        it('throws error when multiple users are found for the site', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowing.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const dispatcher = createFollowingDispatcher(
                mockAccountServiceForFollowing,
                mockHostDataContextLoaderForFollowing,
            );

            await expect(
                dispatcher(followingCtx, 'testuser', '0'),
            ).rejects.toThrow('Multiple users found for host: example.com');
        });
    });

    describe('createFollowersCounter', () => {
        const mockHostDataContextLoaderForFollowersCounter = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockAccountServiceForFollowersCounter = {
            getFollowerAccountsCount: vi.fn(),
        } as unknown as AccountService;

        const mockAccountForFollowersCounter: Account = {
            id: 1,
            uuid: 'test-uuid',
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: new URL('https://example.com/user/testuser'),
            avatarUrl: null,
            bannerImageUrl: null,
            apId: new URL('https://example.com/user/testuser'),
            apInbox: new URL('https://example.com/user/testuser/inbox'),
            apOutbox: new URL('https://example.com/user/testuser/outbox'),
            apFollowing: new URL('https://example.com/user/testuser/following'),
            apFollowers: new URL('https://example.com/user/testuser/followers'),
            apLiked: new URL('https://example.com/user/testuser/liked'),
            isInternal: true,
            customFields: null,
        } as Account;

        let followersCounterCtx: FedifyRequestContext;

        beforeEach(() => {
            followersCounterCtx = {
                data: {
                    logger: {
                        info: vi.fn(),
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
            } as unknown as FedifyRequestContext;
        });

        it('returns follower count', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowersCounter.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForFollowersCounter,
                }),
            );
            vi.mocked(
                mockAccountServiceForFollowersCounter.getFollowerAccountsCount,
            ).mockResolvedValue(10);

            const counter = createFollowersCounter(
                mockAccountServiceForFollowersCounter,
                mockHostDataContextLoaderForFollowersCounter,
            );
            const result = await counter(followersCounterCtx, 'testuser');

            expect(result).toBe(10);
            expect(
                mockAccountServiceForFollowersCounter.getFollowerAccountsCount,
            ).toHaveBeenCalledWith(1);
        });

        it('throws error when site is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowersCounter.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const counter = createFollowersCounter(
                mockAccountServiceForFollowersCounter,
                mockHostDataContextLoaderForFollowersCounter,
            );

            await expect(
                counter(followersCounterCtx, 'testuser'),
            ).rejects.toThrow('Site not found for host: example.com');
        });

        it('throws error when account is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowersCounter.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const counter = createFollowersCounter(
                mockAccountServiceForFollowersCounter,
                mockHostDataContextLoaderForFollowersCounter,
            );

            await expect(
                counter(followersCounterCtx, 'testuser'),
            ).rejects.toThrow('Account not found for host: example.com');
        });

        it('throws error when multiple users are found for the site', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowersCounter.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const counter = createFollowersCounter(
                mockAccountServiceForFollowersCounter,
                mockHostDataContextLoaderForFollowersCounter,
            );

            await expect(
                counter(followersCounterCtx, 'testuser'),
            ).rejects.toThrow('Multiple users found for host: example.com');
        });
    });

    describe('createFollowingCounter', () => {
        const mockHostDataContextLoaderForFollowingCounter = {
            loadDataForHost: vi.fn(),
        } as unknown as HostDataContextLoader;

        const mockAccountServiceForFollowingCounter = {
            getFollowingAccountsCount: vi.fn(),
        } as unknown as AccountService;

        const mockAccountForFollowingCounter: Account = {
            id: 1,
            uuid: 'test-uuid',
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: new URL('https://example.com/user/testuser'),
            avatarUrl: null,
            bannerImageUrl: null,
            apId: new URL('https://example.com/user/testuser'),
            apInbox: new URL('https://example.com/user/testuser/inbox'),
            apOutbox: new URL('https://example.com/user/testuser/outbox'),
            apFollowing: new URL('https://example.com/user/testuser/following'),
            apFollowers: new URL('https://example.com/user/testuser/followers'),
            apLiked: new URL('https://example.com/user/testuser/liked'),
            isInternal: true,
            customFields: null,
        } as Account;

        let followingCounterCtx: FedifyRequestContext;

        beforeEach(() => {
            followingCounterCtx = {
                data: {
                    logger: {
                        info: vi.fn(),
                        error: vi.fn(),
                    },
                },
                host: 'example.com',
            } as unknown as FedifyRequestContext;
        });

        it('returns following count', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowingCounter.loadDataForHost,
            ).mockResolvedValue(
                ok({
                    site: mockSite,
                    account: mockAccountForFollowingCounter,
                }),
            );
            vi.mocked(
                mockAccountServiceForFollowingCounter.getFollowingAccountsCount,
            ).mockResolvedValue(25);

            const counter = createFollowingCounter(
                mockAccountServiceForFollowingCounter,
                mockHostDataContextLoaderForFollowingCounter,
            );
            const result = await counter(followingCounterCtx, 'testuser');

            expect(result).toBe(25);
            expect(
                mockAccountServiceForFollowingCounter.getFollowingAccountsCount,
            ).toHaveBeenCalledWith(1);
        });

        it('throws error when site is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowingCounter.loadDataForHost,
            ).mockResolvedValue(error('site-not-found'));

            const counter = createFollowingCounter(
                mockAccountServiceForFollowingCounter,
                mockHostDataContextLoaderForFollowingCounter,
            );

            await expect(
                counter(followingCounterCtx, 'testuser'),
            ).rejects.toThrow('Site not found for host: example.com');
        });

        it('throws error when account is not found', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowingCounter.loadDataForHost,
            ).mockResolvedValue(error('account-not-found'));

            const counter = createFollowingCounter(
                mockAccountServiceForFollowingCounter,
                mockHostDataContextLoaderForFollowingCounter,
            );

            await expect(
                counter(followingCounterCtx, 'testuser'),
            ).rejects.toThrow('Account not found for host: example.com');
        });

        it('throws error when multiple users are found for the site', async () => {
            vi.mocked(
                mockHostDataContextLoaderForFollowingCounter.loadDataForHost,
            ).mockResolvedValue(error('multiple-users-for-site'));

            const counter = createFollowingCounter(
                mockAccountServiceForFollowingCounter,
                mockHostDataContextLoaderForFollowingCounter,
            );

            await expect(
                counter(followingCounterCtx, 'testuser'),
            ).rejects.toThrow('Multiple users found for host: example.com');
        });
    });
});
