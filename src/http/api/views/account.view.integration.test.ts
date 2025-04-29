import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Knex } from 'knex';

import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { AsyncEvents } from 'core/events';
import { lookupAPIdByHandle } from 'lookup-helpers';
import { Audience, Post, PostType } from 'post/post.entity';
import { KnexPostRepository } from 'post/post.repository.knex';
import { SiteService } from 'site/site.service';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import type { AccountDTO } from '../types';
import { AccountView } from './account.view';

const TEST_TIMEOUT = 10_000;

vi.mock('lookup-helpers', () => ({
    lookupAPIdByHandle: vi.fn(),
    lookupObject: vi.fn(),
}));

describe('AccountView', () => {
    let db: Knex;
    let siteService: SiteService;
    let accountService: AccountService;
    let postRepository: KnexPostRepository;
    let accountView: AccountView;
    const fedifyContext = {};
    let fixtureManager: FixtureManager;

    beforeAll(async () => {
        db = await createTestDb();

        const events = new AsyncEvents();

        const accountRepository = new KnexAccountRepository(db, events);

        const fedifyContextFactory = {
            getFedifyContext: vi.fn(() => fedifyContext),
        } as unknown as FedifyContextFactory;

        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
        );

        siteService = new SiteService(db, accountService, {
            getSiteSettings: async () => ({
                site: {
                    description: 'Test site',
                    title: 'Test site',
                    icon: 'Test site',
                },
            }),
        });

        postRepository = new KnexPostRepository(db, events);

        accountView = new AccountView(db, fedifyContextFactory);

        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        vi.restoreAllMocks();
    });

    describe('viewById', () => {
        it(
            'should be able to view an internal account by its ID',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const view = await accountView.viewById(account.id!);

                expect(view).not.toBeNull();
                expect(view!.id).toBe(account.id);

                await expect(view).toMatchFileSnapshot(
                    '../__snapshots__/views/AccountView.viewById.no-context.json',
                );
            },
            TEST_TIMEOUT,
        );

        it(
            'should not be able to view an external account by its ID',
            async () => {
                const account = await accountService.createExternalAccount({
                    username: 'external-account',
                    name: 'External Account',
                    bio: 'External Account Bio',
                    avatar_url:
                        'https://example.com/avatars/external-account.png',
                    banner_image_url:
                        'https://example.com/banners/external-account.png',
                    url: 'https://example.com/users/external-account',
                    custom_fields: {},
                    ap_id: 'https://example.com/activitypub/users/external-account',
                    ap_inbox_url:
                        'https://example.com/activitypub/inbox/external-account',
                    ap_outbox_url:
                        'https://example.com/activitypub/outbox/external-account',
                    ap_following_url:
                        'https://example.com/activitypub/following/external-account',
                    ap_followers_url:
                        'https://example.com/activitypub/followers/external-account',
                    ap_liked_url:
                        'https://example.com/activitypub/liked/external-account',
                    ap_shared_inbox_url: null,
                    ap_public_key: '',
                });

                const view = await accountView.viewById(account.id!);

                expect(view).toBeNull();
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of posts for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                await postRepository.save(
                    Post.createFromData(account, {
                        type: PostType.Article,
                        audience: Audience.Public,
                    }),
                );

                const view = await accountView.viewById(account.id!);

                expect(view).not.toBeNull();
                expect(view!.postCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of liked posts for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const post = Post.createFromData(account, {
                    type: PostType.Article,
                    audience: Audience.Public,
                });
                post.addLike(account);
                await postRepository.save(post);

                const view = await accountView.viewById(account.id!);

                expect(view).not.toBeNull();
                expect(view!.likedCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of reposts in the posts count for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const post = Post.createFromData(account, {
                    type: PostType.Article,
                    audience: Audience.Public,
                });
                post.addRepost(account);
                await postRepository.save(post);

                const view = await accountView.viewById(account.id!);

                expect(view).not.toBeNull();
                expect(view!.postCount).toBe(2);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of followers for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const site2 =
                    await siteService.initialiseSiteForHost('site-2.com');
                const site2Account =
                    await accountService.getAccountForSite(site2);
                const site2AccountAsType = await accountService.getByInternalId(
                    site2Account.id!,
                );

                await accountService.recordAccountFollow(
                    siteAccountAsType!,
                    site2AccountAsType!,
                );

                const view = await accountView.viewById(siteAccount.id!);

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followerCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of following for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const site2Account =
                    await siteService.initialiseSiteForHost('site-2.com');
                const site2AccountAsType = await accountService.getByInternalId(
                    site2Account.id!,
                );

                await accountService.recordAccountFollow(
                    site2AccountAsType!,
                    siteAccountAsType!,
                );

                const view = await accountView.viewById(siteAccount.id!);

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followingCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the follow status for the request user',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const requestUserSite =
                    await siteService.initialiseSiteForHost('site-2.com');
                const requestUserAccount =
                    await accountService.getAccountForSite(requestUserSite);
                const requestUserAccountAsType =
                    await accountService.getByInternalId(
                        requestUserAccount.id!,
                    );

                await accountService.recordAccountFollow(
                    requestUserAccountAsType!,
                    siteAccountAsType!,
                );

                const view = await accountView.viewById(siteAccount.id!, {
                    requestUserAccount: requestUserAccount!,
                });

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followsMe).toBe(true);
                expect(view!.followingCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the following status for the request user',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const requestUserSite =
                    await siteService.initialiseSiteForHost('site-2.com');
                const requestUserAccount =
                    await accountService.getAccountForSite(requestUserSite);
                const requestUserAccountAsType =
                    await accountService.getByInternalId(
                        requestUserAccount.id!,
                    );

                await accountService.recordAccountFollow(
                    siteAccountAsType!,
                    requestUserAccountAsType!,
                );

                const view = await accountView.viewById(siteAccount.id!, {
                    requestUserAccount: requestUserAccount!,
                });

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followedByMe).toBe(true);
                expect(view!.followerCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the blocking status for the request user',
            async () => {
                const [[siteAccount], [requestUserAccount]] = await Promise.all(
                    [
                        fixtureManager.createInternalAccount(),
                        fixtureManager.createInternalAccount(),
                    ],
                );

                await fixtureManager.createBlock(
                    requestUserAccount,
                    siteAccount,
                );

                const view = await accountView.viewById(siteAccount.id!, {
                    requestUserAccount: requestUserAccount!,
                });

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.blockedByMe).toBe(true);
            },
            TEST_TIMEOUT,
        );
    });

    describe('viewByHandle', () => {
        it(
            'should be able to view an account by its handle',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const handle = `@${account.username}@${site.host}`;
                const expectedApId = account.apId.toString();

                vi.mocked(lookupAPIdByHandle).mockImplementation(
                    async (_fedifyContext, _handle) => {
                        if (
                            _fedifyContext === fedifyContext &&
                            _handle === handle
                        ) {
                            return Promise.resolve(expectedApId);
                        }

                        return Promise.resolve(null);
                    },
                );

                const mockAccountView = { id: 123 } as unknown as AccountDTO;

                const spy = vi
                    .spyOn(AccountView.prototype, 'viewByApId')
                    .mockImplementation(async (apId) => {
                        if (apId === expectedApId) {
                            return Promise.resolve(mockAccountView);
                        }

                        return Promise.resolve(null);
                    });

                const view = await accountView.viewByHandle(handle, {});

                expect(view).toBe(mockAccountView);
                expect(spy).toHaveBeenCalledWith(expectedApId, {});
            },
            TEST_TIMEOUT,
        );

        it(
            'should return null if the AP ID cannot be resolved for the handle',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const spy = vi.spyOn(AccountView.prototype, 'viewByApId');

                vi.mocked(lookupAPIdByHandle).mockResolvedValue(null);

                const view = await accountView.viewByHandle(
                    `@${account.username}@${site.host}`,
                    {},
                );

                expect(view).toBeNull();
                expect(spy).not.toHaveBeenCalled();
            },
            TEST_TIMEOUT,
        );
    });

    describe('viewByApId', () => {
        it(
            'should be able to view an internal account by its AP ID',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const view = await accountView.viewByApId(
                    account.apId.toString(),
                );

                expect(view).not.toBeNull();
                expect(view!.id).toBe(account.id);

                await expect(view).toMatchFileSnapshot(
                    '../__snapshots__/views/AccountView.viewByApId.internal-no-context.json',
                );
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of posts for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                await postRepository.save(
                    Post.createFromData(account, {
                        type: PostType.Article,
                        audience: Audience.Public,
                    }),
                );

                const view = await accountView.viewByApId(
                    account.apId.toString(),
                );

                expect(view).not.toBeNull();
                expect(view!.postCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of liked posts for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const post = Post.createFromData(account, {
                    type: PostType.Article,
                    audience: Audience.Public,
                });
                post.addLike(account);
                await postRepository.save(post);

                const view = await accountView.viewByApId(
                    account.apId.toString(),
                );

                expect(view).not.toBeNull();
                expect(view!.likedCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of reposts in the posts count for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('example.com');
                const account = await accountService.getAccountForSite(site);

                const post = Post.createFromData(account, {
                    type: PostType.Article,
                    audience: Audience.Public,
                });
                post.addRepost(account);
                await postRepository.save(post);

                const view = await accountView.viewByApId(
                    account.apId.toString(),
                );

                expect(view).not.toBeNull();
                expect(view!.postCount).toBe(2);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of followers for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const site2Account =
                    await siteService.initialiseSiteForHost('site-2.com');
                const site2AccountAsType = await accountService.getByInternalId(
                    site2Account.id!,
                );

                await accountService.recordAccountFollow(
                    siteAccountAsType!,
                    site2AccountAsType!,
                );

                const view = await accountView.viewByApId(
                    siteAccount.apId.toString(),
                );

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followerCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the number of following for the account',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const site2Account =
                    await siteService.initialiseSiteForHost('site-2.com');
                const site2AccountAsType = await accountService.getByInternalId(
                    site2Account.id!,
                );

                await accountService.recordAccountFollow(
                    site2AccountAsType!,
                    siteAccountAsType!,
                );

                const view = await accountView.viewByApId(
                    siteAccount.apId.toString(),
                );

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followingCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the follow status for the request user',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const requestUserSite =
                    await siteService.initialiseSiteForHost('site-2.com');
                const requestUserAccount =
                    await accountService.getAccountForSite(requestUserSite);
                const requestUserAccountAsType =
                    await accountService.getByInternalId(
                        requestUserAccount.id!,
                    );

                await accountService.recordAccountFollow(
                    requestUserAccountAsType!,
                    siteAccountAsType!,
                );

                const view = await accountView.viewByApId(
                    siteAccount.apId.toString(),
                    {
                        requestUserAccount: requestUserAccount!,
                    },
                );

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followsMe).toBe(true);
                expect(view!.followingCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the following status for the request user',
            async () => {
                const site =
                    await siteService.initialiseSiteForHost('site-1.com');
                const siteAccount =
                    await accountService.getAccountForSite(site);
                const siteAccountAsType = await accountService.getByInternalId(
                    siteAccount.id!,
                );
                const requestUserSite =
                    await siteService.initialiseSiteForHost('site-2.com');
                const requestUserAccount =
                    await accountService.getAccountForSite(requestUserSite);
                const requestUserAccountAsType =
                    await accountService.getByInternalId(
                        requestUserAccount.id!,
                    );

                await accountService.recordAccountFollow(
                    siteAccountAsType!,
                    requestUserAccountAsType!,
                );

                const view = await accountView.viewByApId(
                    siteAccount.apId.toString(),
                    {
                        requestUserAccount: requestUserAccount!,
                    },
                );

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.followedByMe).toBe(true);
                expect(view!.followerCount).toBe(1);
            },
            TEST_TIMEOUT,
        );

        it(
            'should include the blocking status for the request user',
            async () => {
                const [[siteAccount], [requestUserAccount]] = await Promise.all(
                    [
                        fixtureManager.createInternalAccount(),
                        fixtureManager.createInternalAccount(),
                    ],
                );

                await fixtureManager.createBlock(
                    requestUserAccount,
                    siteAccount,
                );

                const view = await accountView.viewByApId(
                    siteAccount.apId.toString(),
                    {
                        requestUserAccount: requestUserAccount!,
                    },
                );

                expect(view).not.toBeNull();
                expect(view!.id).toBe(siteAccount.id);

                expect(view!.blockedByMe).toBe(true);
            },
            TEST_TIMEOUT,
        );
    });
});
