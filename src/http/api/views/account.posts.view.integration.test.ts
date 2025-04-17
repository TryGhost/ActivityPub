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
import { getValue, isError } from 'core/result';
import type { Knex } from 'knex';
import { Audience, Post, PostType } from 'post/post.entity';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
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

    beforeAll(async () => {
        db = await createTestDb();
    });

    beforeEach(async () => {
        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db('posts').truncate();
        await db('accounts').truncate();
        await db('users').truncate();
        await db('sites').truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

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

            await db('posts').insert({
                author_id: accountEntity.id,
                type: post.type,
                title: post.title,
                content: post.content,
                url: post.url.href,
                published_at: post.publishedAt,
                ap_id: post.apId.href,
                audience: post.audience,
            });

            const result = await viewer.getPostsByHandle(
                accountEntity.username,
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
                authoredByMe: true,
            });
        });

        it('should handle empty results', async () => {
            if (!accountEntity || !siteDefaultAccount) {
                throw new Error('Required accounts not found');
            }

            const result = await viewer.getPostsByHandle(
                accountEntity.username,
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

            await db('posts').insert([
                {
                    author_id: accountEntity.id,
                    type: post1.type,
                    title: post1.title,
                    content: post1.content,
                    url: post1.url.href,
                    published_at: post1.publishedAt,
                    ap_id: post1.apId.href,
                    audience: post1.audience,
                },
                {
                    author_id: accountEntity.id,
                    type: post2.type,
                    title: post2.title,
                    content: post2.content,
                    url: post2.url.href,
                    published_at: post2.publishedAt,
                    ap_id: post2.apId.href,
                    audience: post2.audience,
                },
            ]);

            // Get first page
            const result1 = await viewer.getPostsByHandle(
                accountEntity.username,
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
            const result2 = await viewer.getPostsByHandle(
                accountEntity.username,
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
});
