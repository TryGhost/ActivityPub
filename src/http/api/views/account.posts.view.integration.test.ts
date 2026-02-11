import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { AsyncEvents } from '@/core/events';
import { getError, getValue, isError } from '@/core/result';
import type { AccountPosts } from '@/http/api/views/account.posts.view';
import { AccountPostsView } from '@/http/api/views/account.posts.view';
import { Audience, Post, PostType } from '@/post/post.entity';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('AccountPostsView', () => {
    let viewer: AccountPostsView;
    let events: AsyncEvents;
    let db: Knex;
    let siteDefaultAccount: Account | null;
    let accountEntity: Account | null;
    let postRepository: KnexPostRepository;
    let fixtureManager: FixtureManager;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        // Clean up the database
        await fixtureManager.reset();

        const logger = {
            info: vi.fn(),
            debug: vi.fn(),
        } as unknown as Logger;

        events = new AsyncEvents();
        postRepository = new KnexPostRepository(db, events, logger);
        const fedifyContextFactory = new FedifyContextFactory();

        viewer = new AccountPostsView(db, fedifyContextFactory);

        const [accountEntityTemp] =
            await fixtureManager.createInternalAccount();
        accountEntity = accountEntityTemp;

        const [siteDefaultAccountTemp] =
            await fixtureManager.createInternalAccount();
        siteDefaultAccount = siteDefaultAccountTemp;
    });

    describe('getPostsByHandle', () => {
        it('should return posts for internal account with correct format', async () => {
            if (!accountEntity || !siteDefaultAccount) {
                throw new Error('Required accounts not found');
            }

            // Create a test post
            const post = Post.createFromData(accountEntity, {
                type: PostType.Note,
                content: 'Test content',
                url: new URL('https://example.com/post/1'),
                apId: new URL('https://example.com/post/1'),
                publishedAt: new Date(),
                audience: Audience.Public,
            });

            await postRepository.save(post);

            const result = await viewer.getPostsByApId(
                accountEntity.apId,
                accountEntity,
                siteDefaultAccount,
                10,
                null,
            );

            expect(isError(result)).toBe(false);
            const value = getValue(result as [null, AccountPosts]);

            expect(value).toHaveProperty('results');
            expect(value.results).toHaveLength(1);
            expect(value.results[0]).toMatchObject({
                type: PostType.Note,
                title: '',
                content: 'Test content',
                url: 'https://example.com/post/1',
                author: {
                    id: String(accountEntity.id),
                    handle: `@${accountEntity.username}@${accountEntity.url.host}`,
                    name: accountEntity.name,
                },
                authoredByMe: false,
            });
        });

        it('should handle empty results', async () => {
            if (!accountEntity || !siteDefaultAccount) {
                throw new Error('Required accounts not found');
            }

            const result = await viewer.getPostsByApId(
                accountEntity.apId,
                accountEntity,
                siteDefaultAccount,
                10,
                null,
            );

            expect(isError(result)).toBe(false);
            const value = getValue(result as [null, AccountPosts]);

            expect(value).toMatchObject({
                results: [],
                nextCursor: null,
            });
        });

        it('should handle pagination', async () => {
            if (!accountEntity || !siteDefaultAccount) {
                throw new Error('Required accounts not found');
            }

            // Create multiple posts
            const post1 = Post.createFromData(accountEntity, {
                type: PostType.Note,
                content: 'Content 1',
                url: new URL('https://example.com/post/1'),
                apId: new URL('https://example.com/post/1'),
                publishedAt: new Date('2023-01-01'),
                audience: Audience.Public,
            });

            const post2 = Post.createFromData(accountEntity, {
                type: PostType.Note,
                content: 'Content 2',
                url: new URL('https://example.com/post/2'),
                apId: new URL('https://example.com/post/2'),
                publishedAt: new Date('2023-01-02'),
                audience: Audience.Public,
            });

            await postRepository.save(post1);
            await postRepository.save(post2);

            // Get first page
            const result1 = await viewer.getPostsByApId(
                accountEntity.apId,
                accountEntity,
                siteDefaultAccount,
                1,
                null,
            );

            expect(isError(result1)).toBe(false);
            const value1 = getValue(result1 as [null, AccountPosts]);

            expect(value1.results).toHaveLength(1);
            expect(value1.nextCursor).toBeTruthy();

            // Get second page
            const result2 = await viewer.getPostsByApId(
                accountEntity.apId,
                accountEntity,
                siteDefaultAccount,
                1,
                value1.nextCursor,
            );

            expect(isError(result2)).toBe(false);
            const value2 = getValue(result2 as [null, AccountPosts]);

            expect(value2.results).toHaveLength(1);
            expect(value2.nextCursor).toBeNull();
        });
    });

    describe('getPostsFromOutbox', () => {
        let account: Account;
        let contextAccount: Account;

        beforeEach(async () => {
            [account] = await fixtureManager.createInternalAccount();
            [contextAccount] = await fixtureManager.createInternalAccount();
        });

        it('returns posts in descending outbox order', async () => {
            const post1 = await fixtureManager.createPost(account);
            const post2 = await fixtureManager.createPost(account);
            const result = await viewer.getPostsFromOutbox(
                account,
                contextAccount.id,
                10,
                null,
            );
            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const posts = getValue(result);
                expect(posts.results[0].id).toBe(post2.apId.href);
                expect(posts.results[1].id).toBe(post1.apId.href);
            }
        });

        it('populates reposter fields only for reposts', async () => {
            const post = await fixtureManager.createPost(account);
            const [reposter] = await fixtureManager.createInternalAccount();
            post.addRepost(reposter);
            await postRepository.save(post);
            const result = await viewer.getPostsFromOutbox(
                reposter,
                contextAccount.id,
                10,
                null,
            );
            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const accountPosts = getValue(result);
                expect(accountPosts.results[0].repostedBy).toMatchObject({
                    id: reposter.id.toString(),
                });
            }

            // Original post for account should not have repostedBy
            const resultOriginal = await viewer.getPostsFromOutbox(
                account,
                contextAccount.id,
                10,
                null,
            );
            expect(isError(resultOriginal)).toBe(false);
            if (!isError(resultOriginal)) {
                const accountPosts = getValue(resultOriginal);
                expect(accountPosts.results[0].repostedBy).toBeNull();
            }
        });

        it('does not return replies', async () => {
            const post = await fixtureManager.createPost(account);

            await fixtureManager.createReply(account, post);

            const result = await viewer.getPostsFromOutbox(
                account,
                contextAccount.id,
                10,
                null,
            );
            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const accountPosts = getValue(result);
                expect(accountPosts.results).toHaveLength(1);
                expect(accountPosts.results[0].id).toBe(post.apId.href);
            }
        });

        it('sets likedByMe and repostedByMe correctly', async () => {
            const post = await fixtureManager.createPost(account);
            await postRepository.save(post);
            const resultBeforeLikeAndRepost = await viewer.getPostsFromOutbox(
                account,
                contextAccount.id,
                10,
                null,
            );

            expect(isError(resultBeforeLikeAndRepost)).toBe(false);
            if (!isError(resultBeforeLikeAndRepost)) {
                const accountPosts = getValue(resultBeforeLikeAndRepost);

                expect(accountPosts.results[0].likedByMe).toBe(false);
                expect(accountPosts.results[0].repostedByMe).toBe(false);
            }

            post.addLike(contextAccount);
            post.addRepost(contextAccount);
            await postRepository.save(post);

            const resultAfterLikeAndRepost = await viewer.getPostsFromOutbox(
                account,
                contextAccount.id,
                10,
                null,
            );
            expect(isError(resultAfterLikeAndRepost)).toBe(false);
            if (!isError(resultAfterLikeAndRepost)) {
                const accountPosts = getValue(resultAfterLikeAndRepost);
                expect(accountPosts.results[0].likedByMe).toBe(true);
                expect(accountPosts.results[0].repostedByMe).toBe(true);
            }
        });

        it('paginates results and returns correct nextCursor', async () => {
            const post1 = await fixtureManager.createPost(account);
            const post2 = await fixtureManager.createPost(account);
            const result1 = await viewer.getPostsFromOutbox(
                account,
                contextAccount.id,
                1,
                null,
            );
            expect(isError(result1)).toBe(false);
            if (!isError(result1)) {
                const accountPosts = getValue(result1);
                expect(accountPosts.results).toHaveLength(1);
                expect(accountPosts.results[0].id).toBe(post2.apId.href);
                expect(accountPosts.nextCursor).toBeTruthy();

                const result2 = await viewer.getPostsFromOutbox(
                    account,
                    contextAccount.id,
                    1,
                    accountPosts.nextCursor,
                );
                expect(isError(result2)).toBe(false);
                if (!isError(result2)) {
                    const accountPosts2 = getValue(result2);
                    expect(accountPosts2.results).toHaveLength(1);
                    expect(accountPosts2.results[0].id).toBe(post1.apId.href);
                    expect(accountPosts2.nextCursor).toBeNull();
                }
            }
        });

        it('returns an error if the account is not internal', async () => {
            const externalAccount =
                await fixtureManager.createExternalAccount();

            await fixtureManager.createPost(externalAccount);

            const result = await viewer.getPostsFromOutbox(
                externalAccount,
                contextAccount.id,
                10,
                null,
            );
            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toBe('not-internal-account');
            }
        });
    });

    describe('followedByMe flag', () => {
        describe('getPostsFromOutbox (database flow)', () => {
            it('should correctly set followedByMe flag for post authors', async () => {
                const [viewingAccount] =
                    await fixtureManager.createInternalAccount();
                const [followedAuthor] =
                    await fixtureManager.createInternalAccount();
                const [unfollowedAuthor] =
                    await fixtureManager.createInternalAccount();

                // Set up follow relationship
                await fixtureManager.createFollow(
                    viewingAccount,
                    followedAuthor,
                );

                // Create posts
                await fixtureManager.createPost(followedAuthor);
                await fixtureManager.createPost(unfollowedAuthor);

                // Get posts from followed author's outbox
                const followedResult = await viewer.getPostsFromOutbox(
                    followedAuthor,
                    viewingAccount.id,
                    10,
                    null,
                );

                expect(isError(followedResult)).toBe(false);
                if (!isError(followedResult)) {
                    const posts = getValue(followedResult);
                    expect(posts.results).toHaveLength(1);
                    expect(posts.results[0].author.followedByMe).toBe(true);
                }

                // Get posts from unfollowed author's outbox
                const unfollowedResult = await viewer.getPostsFromOutbox(
                    unfollowedAuthor,
                    viewingAccount.id,
                    10,
                    null,
                );

                expect(isError(unfollowedResult)).toBe(false);
                if (!isError(unfollowedResult)) {
                    const posts = getValue(unfollowedResult);
                    expect(posts.results).toHaveLength(1);
                    expect(posts.results[0].author.followedByMe).toBe(false);
                }
            });

            it('should correctly set followedByMe flag for reposters', async () => {
                const [viewingAccount] =
                    await fixtureManager.createInternalAccount();
                const [postAuthor] =
                    await fixtureManager.createInternalAccount();
                const [followedReposter] =
                    await fixtureManager.createInternalAccount();
                const [unfollowedReposter] =
                    await fixtureManager.createInternalAccount();

                // Set up follow relationships
                await fixtureManager.createFollow(
                    viewingAccount,
                    followedReposter,
                );
                await fixtureManager.createFollow(viewingAccount, postAuthor);

                // Create original post
                const originalPost =
                    await fixtureManager.createPost(postAuthor);

                // Add reposts
                originalPost.addRepost(followedReposter);
                await postRepository.save(originalPost);

                originalPost.addRepost(unfollowedReposter);
                await postRepository.save(originalPost);

                // Get posts from followed reposter's outbox
                const followedResult = await viewer.getPostsFromOutbox(
                    followedReposter,
                    viewingAccount.id,
                    10,
                    null,
                );

                expect(isError(followedResult)).toBe(false);
                if (!isError(followedResult)) {
                    const posts = getValue(followedResult);
                    expect(posts.results).toHaveLength(1);
                    expect(posts.results[0].author.followedByMe).toBe(true); // Original author is followed
                    expect(posts.results[0].repostedBy).toBeDefined();
                    expect(posts.results[0].repostedBy!.followedByMe).toBe(
                        true,
                    ); // Reposter is followed
                }

                // Get posts from unfollowed reposter's outbox
                const unfollowedResult = await viewer.getPostsFromOutbox(
                    unfollowedReposter,
                    viewingAccount.id,
                    10,
                    null,
                );

                expect(isError(unfollowedResult)).toBe(false);
                if (!isError(unfollowedResult)) {
                    const posts = getValue(unfollowedResult);
                    expect(posts.results).toHaveLength(1);
                    expect(posts.results[0].author.followedByMe).toBe(true); // Original author is still followed
                    expect(posts.results[0].repostedBy).toBeDefined();
                    expect(posts.results[0].repostedBy!.followedByMe).toBe(
                        false,
                    ); // Reposter is not followed
                }
            });

            it('should handle followedByMe flag when viewing own posts', async () => {
                const [viewingAccount] =
                    await fixtureManager.createInternalAccount();

                // Create own post
                await fixtureManager.createPost(viewingAccount);

                // Get own posts
                const result = await viewer.getPostsFromOutbox(
                    viewingAccount,
                    viewingAccount.id,
                    10,
                    null,
                );

                expect(isError(result)).toBe(false);
                if (!isError(result)) {
                    const posts = getValue(result);
                    expect(posts.results).toHaveLength(1);
                    expect(posts.results[0].author.followedByMe).toBe(false); // Users don't follow themselves
                    expect(posts.results[0].authoredByMe).toBe(true);
                }
            });
        });
    });
});
