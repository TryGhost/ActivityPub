import type { Account } from '@/account/account.entity';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FedifyContext } from '@/app';
import { ok } from '@/core/result';
import { AccountFollowsView } from '@/http/api/views/account.follows.view';
import { ModerationService } from '@/moderation/moderation.service';
import { createTestDb } from '@/test/db';
import { type FixtureManager, createFixtureManager } from '@/test/fixtures';
import { getDocumentLoader } from '@fedify/fedify';
import nock from 'nock';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AccountFollowsView', () => {
    let accountFollowsView: AccountFollowsView;
    let fixtureManager: FixtureManager;
    let siteDefaultAccount: Account | null;
    let fedifyContextFactory: FedifyContextFactory;

    const mockContext = {
        getDocumentLoader: getDocumentLoader,
        data: {
            db: {
                get: vi.fn(),
                set: vi.fn(),
            },
            logger: {
                info: vi.fn(),
                error: vi.fn(),
            },
        },
    } as unknown as FedifyContext;

    function withContext(fn: () => Promise<void>) {
        return async () => {
            await fedifyContextFactory.registerContext(mockContext, fn);
        };
    }

    beforeAll(async () => {
        nock.disableNetConnect();
        const db = await createTestDb();

        fedifyContextFactory = new FedifyContextFactory();

        const moderationService = new ModerationService(db);

        accountFollowsView = new AccountFollowsView(
            db,
            fedifyContextFactory,
            moderationService,
        );

        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        vi.resetAllMocks();
    });

    describe('getFollowsByAccount', () => {
        it('should return following accounts with correct format', async () => {
            const [
                [accountMakingRequest],
                [accountToReadFollows],
                [followingAccountOne],
                [followingAccountTwo],
                [followingAccountThree],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createFollow(
                accountToReadFollows,
                followingAccountOne,
            );
            await fixtureManager.createFollow(
                accountToReadFollows,
                followingAccountTwo,
            );
            await fixtureManager.createFollow(
                accountToReadFollows,
                followingAccountThree,
            );
            await fixtureManager.createFollow(
                accountMakingRequest,
                followingAccountTwo,
            );
            await fixtureManager.createBlock(
                accountMakingRequest,
                followingAccountOne,
            );
            await fixtureManager.createDomainBlock(
                accountMakingRequest,
                followingAccountThree.apId,
            );

            const result = await accountFollowsView.getFollowsByAccount(
                accountToReadFollows,
                'following',
                0,
                accountMakingRequest,
            );

            expect(result).toHaveProperty('accounts');
            expect(result).toHaveProperty('next', null);

            expect(result.accounts).toHaveLength(3);

            expect(result.accounts[0]).toMatchObject({
                id: followingAccountThree.apId.href,
                name: followingAccountThree.name,
                handle: `@${followingAccountThree.username}@${followingAccountThree.apId.host}`,
                avatarUrl: followingAccountThree.avatarUrl?.href,
                isFollowing: false,
                followedByMe: false,
                blockedByMe: false,
                domainBlockedByMe: true,
            });
            expect(result.accounts[1]).toMatchObject({
                id: followingAccountTwo.apId.href,
                name: followingAccountTwo.name,
                handle: `@${followingAccountTwo.username}@${followingAccountTwo.apId.host}`,
                avatarUrl: followingAccountTwo.avatarUrl?.href,
                isFollowing: true,
                followedByMe: true,
                blockedByMe: false,
                domainBlockedByMe: false,
            });
            expect(result.accounts[2]).toMatchObject({
                id: followingAccountOne.apId.href,
                name: followingAccountOne.name,
                handle: `@${followingAccountOne.username}@${followingAccountOne.apId.host}`,
                avatarUrl: followingAccountOne.avatarUrl?.href,
                isFollowing: false,
                followedByMe: false,
                blockedByMe: true,
                domainBlockedByMe: false,
            });
        });

        it('should return follower accounts with correct format', async () => {
            const [
                [accountMakingRequest],
                [accountToReadFollows],
                [followerAccountOne],
                [followerAccountTwo],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createFollow(
                followerAccountOne,
                accountToReadFollows,
            );
            await fixtureManager.createFollow(
                followerAccountTwo,
                accountToReadFollows,
            );
            await fixtureManager.createFollow(
                accountMakingRequest,
                followerAccountTwo,
            );
            await fixtureManager.createBlock(
                accountMakingRequest,
                followerAccountOne,
            );

            const result = await accountFollowsView.getFollowsByAccount(
                accountToReadFollows,
                'followers',
                0,
                accountMakingRequest,
            );

            expect(result).toHaveProperty('accounts');
            expect(result).toHaveProperty('next', null);

            expect(result.accounts).toHaveLength(2);
            expect(result.accounts[0]).toMatchObject({
                id: followerAccountTwo.apId.href,
                name: followerAccountTwo.name,
                handle: `@${followerAccountTwo.username}@${followerAccountTwo.apId.host}`,
                avatarUrl: followerAccountTwo.avatarUrl?.href,
                isFollowing: true,
                followedByMe: true,
                blockedByMe: false,
            });
            expect(result.accounts[1]).toMatchObject({
                id: followerAccountOne.apId.href,
                name: followerAccountOne.name,
                handle: `@${followerAccountOne.username}@${followerAccountOne.apId.host}`,
                avatarUrl: followerAccountOne.avatarUrl?.href,
                isFollowing: false,
                followedByMe: false,
                blockedByMe: true,
            });
        });

        it('should handle empty results', async () => {
            const [[accountMakingRequest], [accountToReadFollows]] =
                await Promise.all([
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                ]);

            const result = await accountFollowsView.getFollowsByAccount(
                accountToReadFollows,
                'followers',
                0,
                accountMakingRequest,
            );

            expect(result).toMatchObject({
                accounts: [],
                next: null,
            });
        });
    });

    describe('getFollowsByRemoteLookUp', () => {
        it(
            'should handle invalid next parameter error',
            withContext(async () => {
                nock('https://activitypub.ghost.org:443')
                    .get('/.ghost/activitypub/users/index')
                    .reply(
                        200,
                        {
                            '@context': [
                                'https://www.w3.org/ns/activitystreams',
                            ],
                            id: 'https://activitypub.ghost.org/.ghost/activitypub/users/index',
                            type: 'Person',
                            inbox: 'https://activitypub.ghost.org/.ghost/activitypub/inbox/index',
                            followers:
                                'https://activitypub.ghost.org/.ghost/activitypub/followers/index',
                            following:
                                'https://activitypub.ghost.org/.ghost/activitypub/following/index',
                            icon: {
                                type: 'Image',
                                url: 'https://activitypub.ghost.org/content/images/2024/09/ghost-orb-white-squircle-07.png',
                            },
                            liked: 'https://activitypub.ghost.org/.ghost/activitypub/liked/index',
                            name: 'Building ActivityPub',
                            outbox: 'https://activitypub.ghost.org/.ghost/activitypub/outbox/index',
                            preferredUsername: 'index',
                            url: 'https://activitypub.ghost.org/',
                        },
                        {
                            'content-type': 'application/activity+json',
                        },
                    );

                const result =
                    await accountFollowsView.getFollowsByRemoteLookUp(
                        new URL(
                            'https://activitypub.ghost.org/.ghost/activitypub/users/index',
                        ),
                        'https://different-domain.com/next',
                        'following',
                        siteDefaultAccount!,
                    );

                expect(result).toEqual(['invalid-next-parameter', null]);
            }),
        );

        it(
            'should handle not-an-actor error',
            withContext(async () => {
                nock('https://activitypub.ghost.org:443')
                    .get(
                        '/.ghost/activitypub/article/364146f6-7e1e-4afd-aa03-dbcdf527970b',
                    )
                    .reply(
                        200,
                        {
                            '@context': [
                                'https://www.w3.org/ns/activitystreams',
                            ],
                            id: 'https://activitypub.ghost.org/.ghost/activitypub/article/364146f6-7e1e-4afd-aa03-dbcdf527970b',
                            to: 'as:Public',
                            url: 'https://activitypub.ghost.org/blocking-users/',
                            name: 'Blocking users',
                            type: 'Article',
                            image: 'https://activitypub.ghost.org/content/images/2025/05/block.jpg',
                            published: '2025-05-05T10:26:21Z',
                        },
                        {
                            'content-type': 'application/activity+json',
                        },
                    );

                const result =
                    await accountFollowsView.getFollowsByRemoteLookUp(
                        new URL(
                            'https://activitypub.ghost.org/.ghost/activitypub/article/364146f6-7e1e-4afd-aa03-dbcdf527970b',
                        ),
                        '',
                        'following',
                        siteDefaultAccount!,
                    );

                expect(result).toEqual(['not-an-actor', null]);
            }),
        );

        it(
            'should return followers collection when available',
            withContext(async () => {
                const [
                    [followerOne],
                    [followerTwo],
                    [followerThree],
                    [accountMakingRequest],
                ] = await Promise.all([
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                ]);

                await fixtureManager.createFollow(
                    accountMakingRequest,
                    followerTwo,
                );

                await fixtureManager.createBlock(
                    accountMakingRequest,
                    followerOne,
                );

                await fixtureManager.createDomainBlock(
                    accountMakingRequest,
                    followerThree.apId,
                );

                nock('https://activitypub.ghost.org:443')
                    .get('/.ghost/activitypub/users/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://activitypub.ghost.org/.ghost/activitypub/users/index',
                        type: 'Person',
                        inbox: 'https://activitypub.ghost.org/.ghost/activitypub/inbox/index',
                        followers:
                            'https://activitypub.ghost.org/.ghost/activitypub/followers/index',
                        following:
                            'https://activitypub.ghost.org/.ghost/activitypub/following/index',
                        icon: {
                            type: 'Image',
                            url: 'https://activitypub.ghost.org/content/images/2024/09/ghost-orb-white-squircle-07.png',
                        },
                        liked: 'https://activitypub.ghost.org/.ghost/activitypub/liked/index',
                        name: 'Building ActivityPub',
                        outbox: 'https://activitypub.ghost.org/.ghost/activitypub/outbox/index',
                        preferredUsername: 'index',
                        url: 'https://activitypub.ghost.org/',
                    });

                nock('https://activitypub.ghost.org:443')
                    .get('/.ghost/activitypub/followers/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://activitypub.ghost.org/.ghost/activitypub/followers/index',
                        type: 'Collection',
                        totalItems: 4,
                        orderedItems: [
                            followerOne.apId.href,
                            followerTwo.apId.href,
                            followerThree.apId.href,
                            'https://404media.co/.ghost/activitypub/users/index',
                            'https://john.onolan.org/.ghost/activitypub/users/index',
                        ],
                    });

                nock('https://john.onolan.org')
                    .get('/.ghost/activitypub/users/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://john.onolan.org/.ghost/activitypub/users/index',
                        type: 'Person',
                        inbox: 'https://john.onolan.org/.ghost/activitypub/inbox/index',
                        icon: {
                            type: 'Image',
                            url: 'https://john.onolan.org/avatar.jpg',
                        },
                        name: "John O'Nolan",
                        preferredUsername: 'john',
                    });

                nock('https://404media.co')
                    .get('/.ghost/activitypub/users/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://404media.co/.ghost/activitypub/users/index',
                        type: 'Person',
                        inbox: 'https://404media.co/.ghost/activitypub/inbox/index',
                        icon: {
                            type: 'Image',
                            url: 'https://404media.co/avatar.jpg',
                        },
                        name: '404 Media',
                        preferredUsername: 'feed',
                    });

                const result =
                    await accountFollowsView.getFollowsByRemoteLookUp(
                        new URL(
                            'https://activitypub.ghost.org/.ghost/activitypub/users/index',
                        ),
                        '',
                        'followers',
                        accountMakingRequest,
                    );

                expect(result).toEqual(
                    ok({
                        accounts: [
                            {
                                id: followerOne.apId.href,
                                apId: followerOne.apId.href,
                                name: followerOne.name,
                                handle: `@${followerOne.username}@${followerOne.apId.host}`,
                                avatarUrl: followerOne.avatarUrl?.href,
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: true,
                                domainBlockedByMe: false,
                            },
                            {
                                id: followerTwo.apId.href,
                                apId: followerTwo.apId.href,
                                name: followerTwo.name,
                                handle: `@${followerTwo.username}@${followerTwo.apId.host}`,
                                avatarUrl: followerTwo.avatarUrl?.href,
                                isFollowing: true,
                                followedByMe: true,
                                blockedByMe: false,
                                domainBlockedByMe: false,
                            },
                            {
                                id: followerThree.apId.href,
                                apId: followerThree.apId.href,
                                name: followerThree.name,
                                handle: `@${followerThree.username}@${followerThree.apId.host}`,
                                avatarUrl: followerThree.avatarUrl?.href,
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: false,
                                domainBlockedByMe: true,
                            },
                            {
                                id: 'https://404media.co/.ghost/activitypub/users/index',
                                apId: 'https://404media.co/.ghost/activitypub/users/index',
                                name: '404 Media',
                                handle: '@feed@404media.co',
                                avatarUrl: 'https://404media.co/avatar.jpg',
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: false,
                                domainBlockedByMe: false,
                            },
                            {
                                id: 'https://john.onolan.org/.ghost/activitypub/users/index',
                                apId: 'https://john.onolan.org/.ghost/activitypub/users/index',
                                name: "John O'Nolan",
                                handle: '@john@john.onolan.org',
                                avatarUrl: 'https://john.onolan.org/avatar.jpg',
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: false,
                                domainBlockedByMe: false,
                            },
                        ],
                        next: null,
                    }),
                );
            }),
        );

        it(
            'should return following collection when available',
            withContext(async () => {
                const [
                    [followerOne],
                    [followerTwo],
                    [followerThree],
                    [accountMakingRequest],
                ] = await Promise.all([
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                ]);

                await fixtureManager.createFollow(
                    accountMakingRequest,
                    followerTwo,
                );

                await fixtureManager.createBlock(
                    accountMakingRequest,
                    followerOne,
                );

                await fixtureManager.createDomainBlock(
                    accountMakingRequest,
                    followerThree.apId,
                );

                nock('https://activitypub.ghost.org:443')
                    .get('/.ghost/activitypub/users/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://activitypub.ghost.org/.ghost/activitypub/users/index',
                        type: 'Person',
                        inbox: 'https://activitypub.ghost.org/.ghost/activitypub/inbox/index',
                        followers:
                            'https://activitypub.ghost.org/.ghost/activitypub/followers/index',
                        following:
                            'https://activitypub.ghost.org/.ghost/activitypub/following/index',
                        icon: {
                            type: 'Image',
                            url: 'https://activitypub.ghost.org/content/images/2024/09/ghost-orb-white-squircle-07.png',
                        },
                        liked: 'https://activitypub.ghost.org/.ghost/activitypub/liked/index',
                        name: 'Building ActivityPub',
                        outbox: 'https://activitypub.ghost.org/.ghost/activitypub/outbox/index',
                        preferredUsername: 'index',
                        url: 'https://activitypub.ghost.org/',
                    });

                nock('https://activitypub.ghost.org:443')
                    .get('/.ghost/activitypub/following/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://activitypub.ghost.org/.ghost/activitypub/following/index',
                        type: 'Collection',
                        totalItems: 4,
                        orderedItems: [
                            followerOne.apId.href,
                            followerTwo.apId.href,
                            followerThree.apId.href,
                            'https://404media.co/.ghost/activitypub/users/index',
                            'https://john.onolan.org/.ghost/activitypub/users/index',
                        ],
                    });

                nock('https://john.onolan.org')
                    .get('/.ghost/activitypub/users/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://john.onolan.org/.ghost/activitypub/users/index',
                        type: 'Person',
                        inbox: 'https://john.onolan.org/.ghost/activitypub/inbox/index',
                        icon: {
                            type: 'Image',
                            url: 'https://john.onolan.org/avatar.jpg',
                        },
                        name: "John O'Nolan",
                        preferredUsername: 'john',
                    });

                nock('https://404media.co')
                    .get('/.ghost/activitypub/users/index')
                    .reply(200, {
                        '@context': ['https://www.w3.org/ns/activitystreams'],
                        id: 'https://404media.co/.ghost/activitypub/users/index',
                        type: 'Person',
                        inbox: 'https://404media.co/.ghost/activitypub/inbox/index',
                        icon: {
                            type: 'Image',
                            url: 'https://404media.co/avatar.jpg',
                        },
                        name: '404 Media',
                        preferredUsername: 'feed',
                    });

                const result =
                    await accountFollowsView.getFollowsByRemoteLookUp(
                        new URL(
                            'https://activitypub.ghost.org/.ghost/activitypub/users/index',
                        ),
                        '',
                        'following',
                        accountMakingRequest,
                    );

                expect(result).toEqual(
                    ok({
                        accounts: [
                            {
                                id: followerOne.apId.href,
                                apId: followerOne.apId.href,
                                name: followerOne.name,
                                handle: `@${followerOne.username}@${followerOne.apId.host}`,
                                avatarUrl: followerOne.avatarUrl?.href,
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: true,
                                domainBlockedByMe: false,
                            },
                            {
                                id: followerTwo.apId.href,
                                apId: followerTwo.apId.href,
                                name: followerTwo.name,
                                handle: `@${followerTwo.username}@${followerTwo.apId.host}`,
                                avatarUrl: followerTwo.avatarUrl?.href,
                                isFollowing: true,
                                followedByMe: true,
                                blockedByMe: false,
                                domainBlockedByMe: false,
                            },
                            {
                                id: followerThree.apId.href,
                                apId: followerThree.apId.href,
                                name: followerThree.name,
                                handle: `@${followerThree.username}@${followerThree.apId.host}`,
                                avatarUrl: followerThree.avatarUrl?.href,
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: false,
                                domainBlockedByMe: true,
                            },
                            {
                                id: 'https://404media.co/.ghost/activitypub/users/index',
                                apId: 'https://404media.co/.ghost/activitypub/users/index',
                                name: '404 Media',
                                handle: '@feed@404media.co',
                                avatarUrl: 'https://404media.co/avatar.jpg',
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: false,
                                domainBlockedByMe: false,
                            },
                            {
                                id: 'https://john.onolan.org/.ghost/activitypub/users/index',
                                apId: 'https://john.onolan.org/.ghost/activitypub/users/index',
                                name: "John O'Nolan",
                                handle: '@john@john.onolan.org',
                                avatarUrl: 'https://john.onolan.org/avatar.jpg',
                                isFollowing: false,
                                followedByMe: false,
                                blockedByMe: false,
                                domainBlockedByMe: false,
                            },
                        ],
                        next: null,
                    }),
                );
            }),
        );
    });
});
