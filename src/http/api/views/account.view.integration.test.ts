import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Context } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { ContextData } from '@/app';
import { AsyncEvents } from '@/core/events';
import { error, ok } from '@/core/result';
import type { AccountDTO, AccountDTOWithBluesky } from '@/http/api/types';
import { AccountView } from '@/http/api/views/account.view';
import { lookupActorProfile } from '@/lookup-helpers';
import { Audience, Post, PostType } from '@/post/post.entity';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

vi.mock('@/lookup-helpers', () => ({
    lookupActorProfile: vi.fn(),
    lookupObject: vi.fn(),
}));

describe('AccountView', () => {
    let db: Knex;
    let postRepository: KnexPostRepository;
    let accountView: AccountView;
    const fedifyContext = {
        data: {
            logger: {
                info: vi.fn(),
                error: vi.fn(),
                warn: vi.fn(),
            },
        },
    } as unknown as Context<ContextData>;
    let fixtureManager: FixtureManager;

    beforeAll(async () => {
        db = await createTestDb();

        const events = new AsyncEvents();

        const fedifyContextFactory = {
            getFedifyContext: vi.fn(() => fedifyContext),
        } as unknown as FedifyContextFactory;

        const logger = {
            info: vi.fn(),
        } as unknown as Logger;

        postRepository = new KnexPostRepository(db, events, logger);

        accountView = new AccountView(db, fedifyContextFactory);

        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        vi.restoreAllMocks();
    });

    describe('viewById', () => {
        it('should be able to view an internal account by its ID', async () => {
            const [account] = await fixtureManager.createInternalAccount(
                null,
                'eggs.food',
            );

            const view = await accountView.viewById(account.id!);

            expect(view).not.toBeNull();
            expect(view!.id).toBe(account.id);

            await expect(view).toMatchFileSnapshot(
                '../__snapshots__/views/AccountView.viewById.no-context.json',
            );
        });

        it('should not be able to view an external account by its ID', async () => {
            const account = await fixtureManager.createExternalAccount();

            const view = await accountView.viewById(account.id!);

            expect(view).toBeNull();
        });

        it('should include the number of posts for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await postRepository.save(
                Post.createFromData(account, {
                    type: PostType.Article,
                    audience: Audience.Public,
                }),
            );

            const view = await accountView.viewById(account.id!);

            expect(view).not.toBeNull();
            expect(view!.postCount).toBe(1);
        });

        it('should include the number of liked posts for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            post.addLike(account);
            await postRepository.save(post);

            const view = await accountView.viewById(account.id!);

            expect(view).not.toBeNull();
            expect(view!.likedCount).toBe(1);
        });

        it('should include the number of reposts in the posts count for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            post.addRepost(account);
            await postRepository.save(post);

            const view = await accountView.viewById(account.id!);

            expect(view).not.toBeNull();
            expect(view!.postCount).toBe(2);
        });

        it('should include the number of followers for the account', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [site2Account] = await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(site2Account, siteAccount);

            const view = await accountView.viewById(siteAccount.id!);

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followerCount).toBe(1);
        });

        it('should include the number of following for the account', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [site2Account] = await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(siteAccount, site2Account);

            const view = await accountView.viewById(siteAccount.id!);

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followingCount).toBe(1);
        });

        it('should include the follow status for the request user', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [requestUserAccount] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(siteAccount, requestUserAccount);

            const view = await accountView.viewById(siteAccount.id!, {
                requestUserAccount: requestUserAccount!,
            });

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followsMe).toBe(true);
            expect(view!.followingCount).toBe(1);
        });

        it('should include the following status for the request user', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [requestUserAccount] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(requestUserAccount, siteAccount);

            const view = await accountView.viewById(siteAccount.id!, {
                requestUserAccount: requestUserAccount!,
            });

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followedByMe).toBe(true);
            expect(view!.followerCount).toBe(1);
        });

        it('should include the blocking status for the request user', async () => {
            const [[siteAccount], [requestUserAccount]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createBlock(requestUserAccount, siteAccount);

            const view = await accountView.viewById(siteAccount.id!, {
                requestUserAccount: requestUserAccount!,
            });

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.blockedByMe).toBe(true);
        });

        it('should include the Bluesky integration data for the request user', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(siteAccount);

            const view = (await accountView.viewById(siteAccount.id, {
                requestUserAccount: siteAccount,
            })) as AccountDTOWithBluesky;

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.blueskyEnabled).toBe(true);
            expect(view!.blueskyHandle).toBe(
                `@${siteAccount!.username}@bluesky`,
            );
        });

        it('should not include the Bluesky integration data when the account is not for the request user', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [requestUserAccount] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(siteAccount);

            const view = (await accountView.viewById(siteAccount.id, {
                requestUserAccount: requestUserAccount,
            })) as AccountDTO;

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect('blueskyEnabled' in view!).toBe(false);
            expect('blueskyHandle' in view!).toBe(false);
        });
    });

    describe('viewByHandle', () => {
        it('should be able to view an account by its handle', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            const handle = `@${account.username}@${site.host}`;
            const expectedApId = account.apId.toString();

            vi.mocked(lookupActorProfile).mockImplementation(
                async (_fedifyContext, _handle) => {
                    if (
                        _fedifyContext === fedifyContext &&
                        _handle === handle
                    ) {
                        return ok(new URL(expectedApId));
                    }

                    return error('no-links-found');
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
        });

        it('should return null if the AP ID cannot be resolved for the handle', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            const spy = vi.spyOn(AccountView.prototype, 'viewByApId');

            vi.mocked(lookupActorProfile).mockResolvedValue(
                error('no-links-found'),
            );

            const view = await accountView.viewByHandle(
                `@${account.username}@${site.host}`,
                {},
            );

            expect(view).toBeNull();
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('viewByApId', () => {
        it('should be able to view an internal account by its AP ID', async () => {
            const [account] = await fixtureManager.createInternalAccount(
                null,
                'billy-elliot.dance',
            );

            const view = await accountView.viewByApId(account.apId.toString());

            expect(view).not.toBeNull();
            expect(view!.id).toBe(account.id);

            await expect(view).toMatchFileSnapshot(
                '../__snapshots__/views/AccountView.viewByApId.internal-no-context.json',
            );
        });

        it('should include the number of posts for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await postRepository.save(
                Post.createFromData(account, {
                    type: PostType.Article,
                    audience: Audience.Public,
                }),
            );

            const view = await accountView.viewByApId(account.apId.toString());

            expect(view).not.toBeNull();
            expect(view!.postCount).toBe(1);
        });

        it('should include the number of liked posts for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            post.addLike(account);
            await postRepository.save(post);

            const view = await accountView.viewByApId(account.apId.toString());

            expect(view).not.toBeNull();
            expect(view!.likedCount).toBe(1);
        });

        it('should include the number of reposts in the posts count for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            post.addRepost(account);
            await postRepository.save(post);

            const view = await accountView.viewByApId(account.apId.toString());

            expect(view).not.toBeNull();
            expect(view!.postCount).toBe(2);
        });

        it('should include the number of followers for the account', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [site2Account] = await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(site2Account, siteAccount);

            const view = await accountView.viewByApId(
                siteAccount.apId.toString(),
            );

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followerCount).toBe(1);
        });

        it('should include the number of following for the account', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [site2Account] = await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(siteAccount, site2Account);

            const view = await accountView.viewByApId(
                siteAccount.apId.toString(),
            );

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followingCount).toBe(1);
        });

        it('should include the follow status for the request user', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [requestUserAccount] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(siteAccount, requestUserAccount);

            const view = await accountView.viewByApId(
                siteAccount.apId.toString(),
                { requestUserAccount: requestUserAccount! },
            );

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followsMe).toBe(true);
            expect(view!.followingCount).toBe(1);
        });

        it('should include the following status for the request user', async () => {
            const [siteAccount] = await fixtureManager.createInternalAccount();
            const [requestUserAccount] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.createFollow(requestUserAccount, siteAccount);

            const view = await accountView.viewByApId(
                siteAccount.apId.toString(),
                { requestUserAccount: requestUserAccount! },
            );

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.followedByMe).toBe(true);
            expect(view!.followerCount).toBe(1);
        });

        it('should include the blocking status for the request user', async () => {
            const [[siteAccount], [requestUserAccount]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createBlock(requestUserAccount, siteAccount);

            const view = await accountView.viewByApId(
                siteAccount.apId.toString(),
                { requestUserAccount: requestUserAccount! },
            );

            expect(view).not.toBeNull();
            expect(view!.id).toBe(siteAccount.id);

            expect(view!.blockedByMe).toBe(true);
        });

        it('should be able to view an external account by its AP ID', async () => {
            const account = await fixtureManager.createExternalAccount();

            const view = await accountView.viewByApId(account.apId.toString());

            expect(view).toBeNull();
        });
    });
});
