import type { Account } from 'account/account.entity';
import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import type {
    Account as AccountType,
    InternalAccountData,
    Site,
} from 'account/types';
import { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { AsyncEvents } from 'core/events';
import { getError, getValue, isError } from 'core/result';
import type { Knex } from 'knex';
import { Audience, Post, PostType } from 'post/post.entity';
import { KnexPostRepository } from 'post/post.repository.knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountPostsView } from './account.posts.view';
import type { AccountPosts } from './account.posts.view';

describe('AccountPostsView', () => {
    let viewer: AccountPostsView;
    let accountService: AccountService;
    let accountRepository: KnexAccountRepository;
    let events: AsyncEvents;
    let site: Site;
    let internalAccountData: InternalAccountData;
    let db: Knex;
    let defaultAccount: AccountType;
    let siteDefaultAccount: Account | null;
    let account: AccountType;
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

        const siteData = {
            host: 'example.com',
            webhook_secret: 'secret',
        };
        const [id] = await db('sites').insert(siteData);

        site = {
            id,
            ...siteData,
        };

        internalAccountData = {
            username: 'index',
            name: 'Test Site Title',
            bio: 'Test Site Description',
            avatar_url: 'https://example.com/avatar.jpg',
        };

        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(db, events);
        postRepository = new KnexPostRepository(db, events);
        const fedifyContextFactory = new FedifyContextFactory();

        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );

        viewer = new AccountPostsView(db, fedifyContextFactory);

        account = await accountService.createInternalAccount(site, {
            ...internalAccountData,
            username: 'accountToCheck',
            name: 'Account To Check',
        });

        accountEntity = await accountRepository.getByApId(
            new URL(account.ap_id),
        );

        defaultAccount = await accountService.createInternalAccount(site, {
            ...internalAccountData,
            username: 'default',
        });
        siteDefaultAccount = await accountRepository.getByApId(
            new URL(defaultAccount.ap_id),
        );
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
                    handle: `@${accountEntity.username}@${site.host}`,
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
            const reply = await fixtureManager.createReply(account, post);
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
            const post = await fixtureManager.createPost(externalAccount);
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
});
