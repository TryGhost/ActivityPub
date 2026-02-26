import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { AsyncEvents } from '@/core/events';
import { getValue, type Ok } from '@/core/result';
import { FeedService } from '@/feed/feed.service';
import { FeedUpdateService } from '@/feed/feed-update.service';
import { ModerationService } from '@/moderation/moderation.service';
import {
    Audience,
    OutboxType,
    Post,
    PostSummary,
    PostTitle,
    PostType,
} from '@/post/post.entity';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostDerepostedEvent } from '@/post/post-dereposted.event';
import { PostLikedEvent } from '@/post/post-liked.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';
import { PostUpdatedEvent } from '@/post/post-updated.event';
import { SiteService } from '@/site/site.service';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('KnexPostRepository', () => {
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;
    let postRepository: KnexPostRepository;
    let client: Knex;
    let fixtureManager: FixtureManager;

    const getAccount = async (host: string) => {
        const site = await siteService.initialiseSiteForHost(host);
        const account = await accountRepository.getBySite(site);

        return account;
    };

    beforeAll(async () => {
        client = await createTestDb();
        fixtureManager = createFixtureManager(client);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        // Init dependencies
        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(client, events);
        fedifyContextFactory = new FedifyContextFactory();
        accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: `Site ${host} title`,
                        description: `Site ${host} description`,
                        icon: `https://${host}/favicon.ico`,
                        cover_image: `https://${host}/cover.png`,
                        site_uuid: crypto.randomUUID(),
                    },
                };
            },
        });
        const logger = {
            info: vi.fn(),
            debug: vi.fn(),
        } as unknown as Logger;
        postRepository = new KnexPostRepository(client, events, logger);
        const moderationService = new ModerationService(client);
        const feedService = new FeedService(client, moderationService);
        const feedUpdateService = new FeedUpdateService(
            events,
            feedService,
            postRepository,
        );
        feedUpdateService.init();
    });

    describe('Events', () => {
        it('Waits for the post to be added to feeds before returning', async () => {
            const site = await siteService.initialiseSiteForHost('testing.com');
            const account = await accountRepository.getBySite(site);
            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            await postRepository.save(post);

            const rowInDb = await client('feeds')
                .where({
                    post_id: post.id,
                })
                .select('*')
                .first();

            assert(rowInDb, 'A row should have been saved in the DB');
        });

        it('Waits for the deleted post to be removed from feeds before returning', async () => {
            const site = await siteService.initialiseSiteForHost('testing.com');
            const account = await accountRepository.getBySite(site);
            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            await postRepository.save(post);

            const rowInFeedsAfterCreate = await client('feeds')
                .where({
                    post_id: post.id,
                })
                .select('*')
                .first();

            assert(
                rowInFeedsAfterCreate,
                'A row should have been saved in the DB',
            );

            post.delete(account);

            await postRepository.save(post);

            const rowInFeedsAfterDelete = await client('feeds')
                .where({
                    post_id: post.id,
                })
                .select('*')
                .first();

            assert(
                !rowInFeedsAfterDelete,
                'A row should have been removed from the DB',
            );
        });
    });

    describe('Delete', () => {
        it('Can handle a deleted post', async () => {
            const site =
                await siteService.initialiseSiteForHost('testing-delete.com');
            const account = await accountRepository.getBySite(site);
            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            await postRepository.save(post);

            post.delete(account);

            const postDeletedEventPromise: Promise<PostDeletedEvent> =
                new Promise((resolve) => {
                    events.once(PostDeletedEvent.getName(), resolve);
                });

            await postRepository.save(post);

            const rowInDb = await client('posts')
                .where({
                    uuid: post.uuid,
                })
                .select('*')
                .first();

            assert(rowInDb, 'A row should have been saved in the DB');
            expect(rowInDb.deleted_at).not.toBe(null);
            expect(rowInDb.title).toBe('Title');
            expect(rowInDb.content).toBe('<p>Hello, world!</p>');
            expect(rowInDb.excerpt).toBe('Hello, world!');

            const postDeletedEvent = await postDeletedEventPromise;

            expect(postDeletedEvent.getPost().id).toBe(post.id);
        });

        it('Can handle a deleted reply', async () => {
            const site = await siteService.initialiseSiteForHost(
                'testing-deleted-reply.com',
            );
            const account = await accountRepository.getBySite(site);
            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            await postRepository.save(post);

            const reply = Post.createFromData(account, {
                type: PostType.Note,
                content: 'Hey',
                inReplyTo: post,
            });

            await postRepository.save(reply);

            const postRowInDb = await client('posts')
                .where({
                    uuid: post.uuid,
                })
                .select('*')
                .first();

            expect(postRowInDb.reply_count).toBe(1);

            reply.delete(account);

            const postDeletedEventPromise: Promise<PostDeletedEvent> =
                new Promise((resolve) => {
                    events.once(PostDeletedEvent.getName(), resolve);
                });

            await postRepository.save(reply);

            const replyRowInDb = await client('posts')
                .where({
                    uuid: reply.uuid,
                })
                .select('*')
                .first();

            assert(replyRowInDb, 'A row should have been saved in the DB');
            expect(replyRowInDb.deleted_at).not.toBe(null);
            expect(replyRowInDb.content).toBe('Hey');

            const postDeletedEvent = await postDeletedEventPromise;

            expect(postDeletedEvent.getPost().id).toBe(reply.id);

            const postRowAfterDelete = await client('posts')
                .where({
                    uuid: post.uuid,
                })
                .select('*')
                .first();

            expect(postRowAfterDelete.reply_count).toBe(0);
        });

        it('Can handle concurrent delete attempts atomically', async () => {
            // This simulates what happens in production when the same reply is
            // deleted multiple times. This can occur when a delete is sent to
            // many internal accounts at once:
            // - foo.com is followed by bar.com, baz.com and qux.com
            // - foo.com deletes a post
            // - bar.com, baz.com and qux.com all receive the delete and try to
            //   decrement the reply count as part of the delete operation
            const site = await siteService.initialiseSiteForHost(
                'testing-atomic-delete.com',
            );
            const account = await accountRepository.getBySite(site);

            // Create parent with 3 replies
            const parentPost = Post.createNote(account, 'Parent post content');
            await postRepository.save(parentPost);

            const reply1 = Post.createReply(account, 'Reply 1', parentPost);
            const reply2 = Post.createReply(account, 'Reply 2', parentPost);
            const reply3 = Post.createReply(account, 'Reply 3', parentPost);

            await postRepository.save(reply1);
            await postRepository.save(reply2);
            await postRepository.save(reply3);

            // Verify initial state
            let parentFromDb = await client('posts')
                .where({ id: parentPost.id })
                .first();

            expect(parentFromDb.reply_count).toBe(3);

            // Get fresh instances of reply1 to simulate multiple concurrent requests
            const replyInstances = await Promise.all([
                postRepository.getByApId(reply1.apId),
                postRepository.getByApId(reply1.apId),
                postRepository.getByApId(reply1.apId),
            ]);

            // Simulate concurrent delete operations
            const deletePromises = replyInstances.map((instance) => {
                instance!.delete(account);
                return postRepository.save(instance!);
            });

            // All deletes should complete without error
            await expect(Promise.all(deletePromises)).resolves.not.toThrow();

            // Check the final state
            parentFromDb = await client('posts')
                .where({ id: parentPost.id })
                .first();

            // The reply count should be exactly 2 (not 0 or 1)
            // because only ONE delete should have decremented the count
            expect(parentFromDb.reply_count).toBe(2);

            // Verify that the reply is marked as deleted
            const deletedReply = await client('posts')
                .where({ id: reply1.id })
                .first();

            expect(deletedReply.deleted_at).not.toBeNull();
        });

        it('Deletes likes when a post is deleted', async () => {
            const site = await siteService.initialiseSiteForHost(
                'testing-delete-likes.com',
            );
            const account = await accountRepository.getBySite(site);
            const likerAccount = await accountRepository.getBySite(
                await siteService.initialiseSiteForHost('liker-site.com'),
            );

            // Create a new post
            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: randomUUID(),
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing-delete-likes.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            // Add a like from another account
            post.addLike(likerAccount);

            // Save the post with the like
            await postRepository.save(post);

            // Verify that the like exists in the database
            const likesBeforeDelete = await client('likes')
                .where({ post_id: post.id })
                .select('*');
            expect(likesBeforeDelete).toHaveLength(1);

            // Delete the post
            post.delete(account);
            await postRepository.save(post);

            // Verify that the like has been removed from the database
            const likesAfterDelete = await client('likes')
                .where({ post_id: post.id })
                .select('*');
            expect(likesAfterDelete).toHaveLength(0);
        });

        it('Can handle a new deleted post', async () => {
            const site = await siteService.initialiseSiteForHost(
                'testing-new-deleted.com',
            );
            const account = await accountRepository.getBySite(site);
            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: randomUUID(),
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            post.delete(account);

            await postRepository.save(post);

            const rowInDb = await client('posts')
                .where({
                    uuid: post.uuid,
                })
                .select('*')
                .first();

            expect(rowInDb).toBe(undefined);
        });
    });

    it('Can save a Post created with out of bounds fields', async () => {
        const site =
            await siteService.initialiseSiteForHost('testing-saving.com');
        const account = await accountRepository.getBySite(site);
        const post = Post.createFromData(account, {
            type: PostType.Article,
            content: 'Hello, world!',
            inReplyTo: null,
            audience: Audience.Public,
            title: 'Title'.repeat(1000),
            summary: 'Hello, world!'.repeat(1000),
            imageUrl: null,
            publishedAt: new Date('2025-01-01'),
            metadata: null,
        });

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
    });

    it('Can save a Post', async () => {
        const site =
            await siteService.initialiseSiteForHost('testing-saving.com');
        const account = await accountRepository.getBySite(site);
        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
    });

    it('Handles attempting to insert multiple posts with the same apId', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-saving-multiple-posts-same-ap-id.com',
        );
        const account = await accountRepository.getBySite(site);
        const postApId = new URL(`https://${site.host}/hello-world`);

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const getPost = () => {
            return new Post(
                null,
                randomUUID(),
                account,
                PostType.Article,
                Audience.Public,
                PostTitle.parse('Some title'),
                PostSummary.parse('Some excerpt'),
                null,
                'Some content',
                new URL(`https://${site.host}/hello-world`),
                new URL(`https://${site.host}/banners/hello-world.png`),
                new Date('2025-04-03 13:56:00'),
                {
                    ghostAuthors: [],
                },
                0,
                0,
                0,
                null,
                null,
                null,
                [],
                postApId, // Ensure the apId is always the same
            );
        };

        await postRepository.save(getPost());
        await postRepository.save(getPost());

        const rowsInDb = await client('posts')
            .where({
                ap_id: postApId.href,
            })
            .select('*');

        expect(rowsInDb.length).toBe(1);

        expect(eventsEmitSpy).toHaveBeenCalledTimes(1);
        expect(eventsEmitSpy).toHaveBeenCalledWith(
            PostCreatedEvent.getName(),
            expect.any(PostCreatedEvent),
        );
    });

    it('Emits a PostCreatedEvent when a Post is saved', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-post-created-event.com',
        );
        const account = await accountRepository.getBySite(site);

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        await postRepository.save(post);

        expect(eventsEmitSpy).toHaveBeenCalledWith(
            PostCreatedEvent.getName(),
            new PostCreatedEvent(post.id as number),
        );
    });

    it('Does not emit a PostCreatedEvent when a Post is updated', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-post-update.com',
        );
        const account = await accountRepository.getBySite(site);

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        await postRepository.save(post);
        await postRepository.save(post);

        expect(eventsEmitSpy).toHaveBeenCalledTimes(1);
    });

    it('Can get by apId', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-by-apid.com',
        );
        const account = await accountRepository.getBySite(site);
        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        await postRepository.save(post);

        const result = await postRepository.getByApId(post.apId);

        assert(result);

        assert.equal(result.author.uuid, account.uuid);
        assert.equal(result.uuid, post.uuid);
        assert.equal(result.author.apId.href, account.apId.href);
        assert.equal(result.author.apInbox?.href, account.apInbox?.href);
    });

    it('Can get by id', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-by-apid.com',
        );
        const account = await accountRepository.getBySite(site);
        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        await postRepository.save(post);

        const result = await postRepository.getById(post.id);

        assert(result);

        assert.equal(result.author.uuid, account.uuid);
        assert.equal(result.uuid, post.uuid);
        assert.equal(result.author.apId.href, account.apId.href);
        assert.equal(result.author.apInbox?.href, account.apInbox?.href);
    });

    it('Ensures an account associated with a post has a uuid when retrieved by apId', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-account-uuid.com',
        );
        const account = await accountRepository.getBySite(site);

        if (!account.id) {
            throw new Error('Expected account to have an id');
        }

        // Remove the uuid from the account & verify
        await client('accounts').update({ uuid: null }).where('id', account.id);
        let accountInDb = await client('accounts')
            .where('id', account.id)
            .first();
        assert(accountInDb.uuid === null, 'Account should not have a uuid');

        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        await postRepository.save(post);

        const result = await postRepository.getByApId(post.apId);

        assert(result);

        assert(result.author.uuid !== null);

        // Verify the uuid was added to the account
        accountInDb = await client('accounts').where('id', account.id).first();
        assert(accountInDb.uuid === result.author.uuid);
    });

    it('Handles a deleted post when retrieved by apId', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-deleted-tombstone.com',
        );
        const account = await accountRepository.getBySite(site);
        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        await postRepository.save(post);

        post.delete(account);

        const postDeletedEventPromise: Promise<PostDeletedEvent> = new Promise(
            (resolve) => {
                events.once(PostDeletedEvent.getName(), resolve);
            },
        );

        await postRepository.save(post);

        await postDeletedEventPromise;

        const result = await postRepository.getByApId(post.apId);

        assert(result);

        expect(result.type).toBe(PostType.Tombstone);
        expect(result.title).toBe(null);
        expect(result.content).toBe(null);
        expect(result.excerpt).toBe(null);
        expect(result.imageUrl).toBe(null);
        expect(result.attachments).toEqual([]);
    });

    it('Handles likes of a new post', async () => {
        const accounts = await Promise.all(
            [
                'testing-likes-one.com',
                'testing-likes-two.com',
                'testing-likes-three.com',
            ].map(getAccount),
        );

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const postResult = await Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        post.addLike(accounts[0]);
        post.addLike(accounts[1]);
        post.addLike(accounts[2]);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
        assert.equal(rowInDb.like_count, 3, 'There should be 3 likes');

        const likesInDb = await client('likes')
            .where({
                post_id: post.id,
            })
            .select('*');

        assert.equal(likesInDb.length, 3, 'There should be 3 likes in the DB');

        expect(eventsEmitSpy).toHaveBeenCalledTimes(4); // 1 post created + 3 posts liked
        expect(eventsEmitSpy).nthCalledWith(
            2,
            PostLikedEvent.getName(),
            new PostLikedEvent(
                Number(post.id),
                Number(post.author.id),
                Number(accounts[0].id),
            ),
        );
        expect(eventsEmitSpy).nthCalledWith(
            3,
            PostLikedEvent.getName(),
            new PostLikedEvent(
                Number(post.id),
                Number(post.author.id),
                Number(accounts[1].id),
            ),
        );
        expect(eventsEmitSpy).nthCalledWith(
            4,
            PostLikedEvent.getName(),
            new PostLikedEvent(
                Number(post.id),
                Number(post.author.id),
                Number(accounts[2].id),
            ),
        );
    });

    it('Handles likes and unlikes of an existing post', async () => {
        const accounts = await Promise.all(
            [
                'testing-unlikes-one.com',
                'testing-unlikes-two.com',
                'testing-unlikes-three.com',
            ].map(getAccount),
        );

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const postResult = await Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        post.addLike(accounts[1]);

        await postRepository.save(post);

        post.addLike(accounts[0]);
        post.addLike(accounts[1]);

        await postRepository.save(post);

        post.addLike(accounts[0]);
        post.addLike(accounts[2]);
        post.removeLike(accounts[1]);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('like_count')
            .first();

        assert.equal(rowInDb.like_count, 2, 'There should be 2 likes');

        expect(eventsEmitSpy).toHaveBeenCalledTimes(4); // 1 post created + 3 posts liked
        expect(eventsEmitSpy).nthCalledWith(
            2,
            PostLikedEvent.getName(),
            new PostLikedEvent(
                Number(post.id),
                Number(post.author.id),
                Number(accounts[1].id),
            ),
        );
        expect(eventsEmitSpy).nthCalledWith(
            3,
            PostLikedEvent.getName(),
            new PostLikedEvent(
                Number(post.id),
                Number(post.author.id),
                Number(accounts[0].id),
            ),
        );
        expect(eventsEmitSpy).nthCalledWith(
            4,
            PostLikedEvent.getName(),
            new PostLikedEvent(
                Number(post.id),
                Number(post.author.id),
                Number(accounts[2].id),
            ),
        );
    });

    it('Handles reposts of a new post', async () => {
        const accounts = await Promise.all(
            [
                'testing-reposts-one.com',
                'testing-reposts-two.com',
                'testing-reposts-three.com',
            ].map(getAccount),
        );

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const postResult = await Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        post.addRepost(accounts[1]);
        post.addRepost(accounts[2]);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
        assert.equal(rowInDb.repost_count, 2, 'There should be 2 reposts');

        const repostsInDb = await client('reposts')
            .where({
                post_id: post.id,
            })
            .select('*');

        assert.equal(
            repostsInDb.length,
            2,
            'There should be 2 reposts in the DB',
        );

        expect(eventsEmitSpy).toHaveBeenCalledTimes(3); // 1 post created + 2 post reposted
        expect(eventsEmitSpy).nthCalledWith(
            2,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(Number(post.id), Number(accounts[1].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            3,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(Number(post.id), Number(accounts[2].id)),
        );
    });

    it('Handles reposts and dereposts of an existing post', async () => {
        const accounts = await Promise.all(
            [
                'testing-derepost-one.com',
                'testing-derepost-two.com',
                'testing-derepost-three.com',
            ].map(getAccount),
        );

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const postResult = await Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
            authors: [],
        });
        const post = getValue(postResult as Ok<Post>) as Post;

        post.addRepost(accounts[1]);

        await postRepository.save(post);

        post.addRepost(accounts[0]);
        post.addRepost(accounts[1]);

        await postRepository.save(post);

        post.addRepost(accounts[0]);
        post.addRepost(accounts[2]);
        post.removeRepost(accounts[1]);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('repost_count')
            .first();

        assert.equal(rowInDb.repost_count, 2, 'There should be 2 reposts');

        expect(eventsEmitSpy).toHaveBeenCalledTimes(5); // 1 post created + 3 post reposted + 1 post dereposted
        expect(eventsEmitSpy).nthCalledWith(
            2,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(Number(post.id), Number(accounts[1].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            3,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(Number(post.id), Number(accounts[0].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            4,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(Number(post.id), Number(accounts[2].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            5,
            PostDerepostedEvent.getName(),
            new PostDerepostedEvent(Number(post.id), Number(accounts[1].id)),
        );
    });

    it('Handles replies to an existing post', async () => {
        const accounts = await Promise.all(
            [
                'testing-replies-one.com',
                'testing-replies-two.com',
                'testing-replies-three.com',
            ].map(getAccount),
        );

        const originalPostResult = await Post.createArticleFromGhostPost(
            accounts[0],
            {
                title: 'Original Post',
                uuid: randomUUID(),
                html: '<p>Original content</p>',
                excerpt: 'Original content',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing.com/original-post',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            },
        );

        const originalPost = getValue(originalPostResult as Ok<Post>) as Post;

        await postRepository.save(originalPost);

        const reply1 = Post.createFromData(accounts[1], {
            content: 'Reply 1',
            type: PostType.Note,
            url: new URL('https://testing.com/reply-1'),
            apId: new URL('https://testing.com/reply-1'),
            publishedAt: new Date('2025-01-01'),
            inReplyTo: originalPost,
        });

        await postRepository.save(reply1);

        const reply2 = Post.createFromData(accounts[2], {
            content: 'Reply 2',
            type: PostType.Note,
            url: new URL('https://testing.com/reply-2'),
            apId: new URL('https://testing.com/reply-2'),
            publishedAt: new Date('2025-01-01'),
            inReplyTo: originalPost,
        });

        const reply3 = Post.createFromData(accounts[0], {
            content: 'Reply 3',
            type: PostType.Note,
            url: new URL('https://testing.com/reply-3'),
            apId: new URL('https://testing.com/reply-3'),
            publishedAt: new Date('2025-01-01'),
            inReplyTo: originalPost,
        });

        await postRepository.save(reply2);
        await postRepository.save(reply3);

        const rowInDb = await client('posts')
            .where({
                uuid: originalPost.uuid,
            })
            .select('reply_count')
            .first();

        assert.equal(rowInDb.reply_count, 3, 'There should be 3 replies');

        const repliesInDb = await client('posts')
            .where({
                thread_root: originalPost.id,
            })
            .select('*');

        assert.equal(
            repliesInDb.length,
            3,
            'There should be 3 replies in the DB',
        );
    });

    it('Can save and retrieve a Post with attachments', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-attachments.com',
        );
        const account = await accountRepository.getBySite(site);
        const attachments = [
            {
                type: 'Document',
                mediaType: 'image/jpeg',
                name: 'test-image.jpg',
                url: new URL('https://testing.com/test-image.jpg'),
            },
            {
                type: 'Document',
                mediaType: 'application/pdf',
                name: 'test-document.pdf',
                url: new URL('https://testing.com/test-document.pdf'),
            },
        ];

        const post = Post.createFromData(account, {
            type: PostType.Note,
            content: 'Post with attachments',
            url: new URL('https://testing.com/post-with-attachments'),
            publishedAt: new Date('2025-01-01'),
            attachments: attachments,
        });

        await postRepository.save(post);

        const retrievedPost = await postRepository.getByApId(post.apId);

        assert(retrievedPost, 'Post should be retrieved from DB');
        assert.deepStrictEqual(
            retrievedPost.attachments,
            attachments,
            'Attachments should match',
        );
    });

    it('Can check if a post is liked by an account', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-is-liked-by-account.com',
        );

        const account = await accountRepository.getBySite(site);
        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing-is-liked-by-account.com/hello-world',
            published_at: '2025-04-01',
            visibility: 'public',
            authors: [],
        });

        const post = getValue(postResult as Ok<Post>) as Post;

        post.addLike(account);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'Post should be saved in the DB');

        const isLiked = await postRepository.isLikedByAccount(
            rowInDb.id,
            Number(account.id),
        );

        assert(isLiked, 'Post should be liked by account');
    });

    it('Can check if a post is reposted by an account', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-is-reposted-by-account.com',
        );
        const account = await accountRepository.getBySite(site);
        const reposterAccount = await accountRepository.getBySite(
            await siteService.initialiseSiteForHost('reposter-site.com'),
        );

        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing-is-reposted-by-account.com/hello-world',
            published_at: '2025-04-01',
            visibility: 'public',
            authors: [],
        });

        const post = getValue(postResult as Ok<Post>) as Post;

        post.addRepost(reposterAccount);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'Post should be saved in the DB');

        const isReposted = await postRepository.isRepostedByAccount(
            rowInDb.id,
            Number(reposterAccount.id),
        );

        assert(isReposted, 'Post should be reposted by reposter account');
    });

    it('Includes mentions when getting a post by ID', async () => {
        const accounts = await Promise.all(
            [
                'testing-mentions-1.com',
                'testing-mentions-2.com',
                'testing-mentions-3.com',
            ].map(getAccount),
        );

        const post = Post.createNote(
            accounts[0],
            'Hello, @index@testing-mentions-2.com and @index@testing-mentions-3.com!',
        );

        post.addMention(accounts[1]);
        post.addMention(accounts[2]);

        await postRepository.save(post);

        const fetchedPost = await postRepository.getById(post.id);

        assert(fetchedPost, 'Post should be fetched from DB');
        assert.equal(
            fetchedPost.mentions.length,
            2,
            'Post should have 2 mentions',
        );

        // Check that both mentions exist
        assert(
            fetchedPost.mentions.some((m) => m.id === accounts[1].id),
            'Post should mention second account',
        );
        assert(
            fetchedPost.mentions.some((m) => m.id === accounts[2].id),
            'Post should mention third account',
        );
    });

    it('Includes mentions when getting a post by AP ID', async () => {
        const accounts = await Promise.all(
            [
                'testing-mentions-1.com',
                'testing-mentions-2.com',
                'testing-mentions-3.com',
            ].map(getAccount),
        );

        const post = Post.createNote(
            accounts[0],
            'Hello, @index@testing-mentions-2.com and @index@testing-mentions-3.com!',
        );

        post.addMention(accounts[1]);
        post.addMention(accounts[2]);

        await postRepository.save(post);

        const fetchedPost = await postRepository.getByApId(post.apId);

        assert(fetchedPost, 'Post should be fetched from DB');
        assert.equal(
            fetchedPost.mentions.length,
            2,
            'Post should have 2 mentions',
        );

        // Check that both mentions exist
        assert(
            fetchedPost.mentions.some((m) => m.id === accounts[1].id),
            'Post should mention second account',
        );
        assert(
            fetchedPost.mentions.some((m) => m.id === accounts[2].id),
            'Post should mention third account',
        );
    });

    it('Can save and retrieve a Post with metadata', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-metadata.com',
        );
        const account = await accountRepository.getBySite(site);

        const postResult = await Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            custom_excerpt: null,
            feature_image: null,
            url: 'https://testing-is-reposted-by-account.com/hello-world',
            published_at: '2025-04-01',
            visibility: 'public',
            authors: [
                {
                    name: 'Author 1',
                    profile_image: null,
                },
            ],
        });

        const post = getValue(postResult as Ok<Post>) as Post;
        await postRepository.save(post);
        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'Post should be saved in the DB');
        assert.deepStrictEqual(
            rowInDb.metadata,
            {
                ghostAuthors: [
                    {
                        name: 'Author 1',
                        profile_image: null,
                    },
                ],
            },
            'Metadata should match',
        );
    });

    it('Handles mentions of a new post', async () => {
        const accounts = await Promise.all(
            [
                'testing-mentions-one.com',
                'testing-mentions-two.com',
                'testing-mentions-three.com',
            ].map(getAccount),
        );

        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');

        const post = Post.createNote(
            accounts[0],
            'Hello, @index@testing-mentions-two.com and @index@testing-mentions-three.com!',
        );

        post.addMention(accounts[1]);
        post.addMention(accounts[2]);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');

        const mentionsInDb = await client('mentions')
            .where({
                post_id: post.id,
            })
            .select('*');

        assert.equal(
            mentionsInDb.length,
            2,
            'There should be 2 mentions in the DB',
        );

        expect(eventsEmitSpy).toHaveBeenCalledTimes(1); // 1 post created
        expect(eventsEmitSpy).nthCalledWith(
            1,
            PostCreatedEvent.getName(),
            new PostCreatedEvent(post.id as number),
        );
    });

    it('Adds Article to outbox', async () => {
        const [account] = await fixtureManager.createInternalAccount();
        const post = await fixtureManager.createPost(account, {
            type: PostType.Article,
        });

        const outboxEntry = await client('outboxes')
            .where({
                post_id: post.id,
                outbox_type: OutboxType.Original,
            })
            .select('*')
            .first();

        assert(outboxEntry, 'An outbox entry should have been created');
        assert.equal(
            outboxEntry.post_type,
            PostType.Article,
            'Post type should be Article',
        );
        assert.equal(
            outboxEntry.author_id,
            account.id,
            'Author ID should match',
        );
        assert.equal(
            outboxEntry.account_id,
            account.id,
            'Outbox account ID should match account ID of the post author',
        );
    });

    it('Adds Note to outbox', async () => {
        const [account] = await fixtureManager.createInternalAccount();
        const post = await fixtureManager.createPost(account);

        const outboxEntry = await client('outboxes')
            .where({
                post_id: post.id,
                outbox_type: OutboxType.Original,
            })
            .select('*')
            .first();

        assert(outboxEntry, 'An outbox entry should have been created');
        assert.equal(
            outboxEntry.post_type,
            PostType.Note,
            'Post type should be Note',
        );
        assert.equal(
            outboxEntry.author_id,
            account.id,
            'Author ID should match',
        );
        assert.equal(
            outboxEntry.account_id,
            account.id,
            'Outbox account ID should match account ID of the post author',
        );
    });

    it('Adds Reply to outbox', async () => {
        const [account] = await fixtureManager.createInternalAccount();
        const [replyAccount] = await fixtureManager.createInternalAccount();

        const originalPost = await fixtureManager.createPost(account);

        const reply = await fixtureManager.createReply(
            replyAccount,
            originalPost,
        );

        const outboxEntry = await client('outboxes')
            .where({
                post_id: reply.id,
                outbox_type: OutboxType.Reply,
            })
            .select('*')
            .first();

        assert(outboxEntry, 'An outbox entry should have been created');
        assert.equal(
            outboxEntry.post_type,
            PostType.Note,
            'Post type should be Note',
        );
        assert.equal(
            outboxEntry.author_id,
            replyAccount.id,
            'Author ID should match reply account',
        );
        assert.equal(
            outboxEntry.account_id,
            replyAccount.id,
            'Outbox account ID should match account ID of the reply author',
        );
    });

    it('Adds outbox entries for reposts', async () => {
        const [account] = await fixtureManager.createInternalAccount();
        const [reposter1] = await fixtureManager.createInternalAccount();
        const [reposter2] = await fixtureManager.createInternalAccount();

        const post = await fixtureManager.createPost(account);

        post.addRepost(reposter1);
        post.addRepost(reposter2);
        await postRepository.save(post);

        // Check all outbox entries
        const outboxEntries = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .select('*')
            .orderBy('outbox_type');

        assert.equal(outboxEntries.length, 3, 'Should have 3 outbox entries');

        const originalEntry = outboxEntries.find(
            (entry) => entry.outbox_type === OutboxType.Original,
        );
        assert(originalEntry, 'Should have original post entry');
        assert.equal(
            originalEntry.post_type,
            PostType.Note,
            'Post type should be Note',
        );
        assert.equal(
            originalEntry.author_id,
            account.id,
            'Author ID should match original author',
        );

        // Verify repost entries
        const repostEntries = outboxEntries.filter(
            (entry) => entry.outbox_type === OutboxType.Repost,
        );
        assert.equal(repostEntries.length, 2, 'Should have 2 repost entries');

        const reposter1Entry = repostEntries.find(
            (entry) => entry.account_id === reposter1.id,
        );
        assert(reposter1Entry, 'Should have entry for reposter 1');
        assert.equal(
            reposter1Entry.post_type,
            PostType.Note,
            'Post type should be Note',
        );
        assert.equal(
            reposter1Entry.author_id,
            account.id,
            "Author ID should be original author's account ID",
        );

        const reposter2Entry = repostEntries.find(
            (entry) => entry.account_id === reposter2.id,
        );
        assert(reposter2Entry, 'Should have entry for reposter 2');
        assert.equal(
            reposter2Entry.post_type,
            PostType.Note,
            'Post type should be Note',
        );
        assert.equal(
            reposter2Entry.author_id,
            account.id,
            "Author ID should be original author's account ID",
        );
    });

    it('Updates outbox entries when adding and removing reposts', async () => {
        const [account] = await fixtureManager.createInternalAccount();
        const [reposter1] = await fixtureManager.createInternalAccount();
        const [reposter2] = await fixtureManager.createInternalAccount();

        const post = await fixtureManager.createPost(account);

        const initialOutboxEntries = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .select('*');
        assert.equal(
            initialOutboxEntries.length,
            1,
            'Should have 1 outbox entry initially (original post)',
        );
        assert.equal(
            initialOutboxEntries[0].outbox_type,
            OutboxType.Original,
            'Initial entry should be of type Original',
        );

        // Add two reposts
        post.addRepost(reposter1);
        post.addRepost(reposter2);
        await postRepository.save(post);

        const outboxEntriesAfterReposts = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .select('*');
        assert.equal(
            outboxEntriesAfterReposts.length,
            3,
            'Should have 3 outbox entries after adding reposts (1 original + 2 reposts)',
        );

        // Remove one repost
        post.removeRepost(reposter1);
        await postRepository.save(post);

        const outboxEntriesAfterRemove = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .select('*');
        assert.equal(
            outboxEntriesAfterRemove.length,
            2,
            'Should have 2 outbox entries after removing one repost (1 original + 1 repost)',
        );

        const remainingRepostEntries = outboxEntriesAfterRemove.filter(
            (entry) => entry.outbox_type === OutboxType.Repost,
        );
        assert.equal(
            remainingRepostEntries.length,
            1,
            'Should have 1 repost entry remaining',
        );
        assert.equal(
            remainingRepostEntries[0].account_id,
            reposter2.id,
            'Remaining repost entry should be for reposter 2',
        );
    });

    it('Deletes original post and repost outbox entries when a post is deleted', async () => {
        const [account] = await fixtureManager.createInternalAccount();
        const [reposter1] = await fixtureManager.createInternalAccount();
        const [reposter2] = await fixtureManager.createInternalAccount();

        const post = await fixtureManager.createPost(account);
        post.addRepost(reposter1);
        post.addRepost(reposter2);
        await postRepository.save(post);

        const outboxEntriesBeforeDelete = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .select('*');
        assert.equal(
            outboxEntriesBeforeDelete.length,
            3,
            'Should have 3 outbox entries before deletion (1 for original post + 2 for reposts)',
        );

        // Delete the post
        post.delete(account);
        await postRepository.save(post);

        const outboxEntriesAfterDelete = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .select('*');
        assert.equal(
            outboxEntriesAfterDelete.length,
            0,
            'Should have no outbox entries after deletion',
        );
    });

    it('Preserves reply outbox entries when original post is deleted', async () => {
        const [account] = await fixtureManager.createInternalAccount();

        const post = await fixtureManager.createPost(account);

        const reply = await fixtureManager.createReply(account, post);

        const outboxEntriesBeforeDelete = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .orWhere({
                post_id: reply.id,
            })
            .select('*');
        assert.equal(
            outboxEntriesBeforeDelete.length,
            2,
            'Should have 2 outbox entries before deletion (1 for original post, 1 for reply)',
        );

        // Delete the original post
        post.delete(account);
        await postRepository.save(post);

        const outboxEntriesAfterDelete = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .orWhere({
                post_id: reply.id,
            })
            .select('*');
        assert.equal(
            outboxEntriesAfterDelete.length,
            1,
            'Should have 1 outbox entry after deletion (only the reply entry should remain)',
        );

        const remainingEntry = outboxEntriesAfterDelete[0];
        assert.equal(
            remainingEntry.post_id,
            reply.id,
            'The remaining entry should be for the reply post',
        );
        assert.equal(
            remainingEntry.outbox_type,
            OutboxType.Reply,
            'The remaining entry should be a reply type',
        );
    });

    it('Handles reposting a reply and its deletion', async () => {
        const [account] = await fixtureManager.createInternalAccount();
        const [reposter] = await fixtureManager.createInternalAccount();

        const originalPost = await fixtureManager.createPost(account);

        const originalPostOutbox = await client('outboxes')
            .where({
                post_id: originalPost.id,
            })
            .select('*');
        assert.equal(
            originalPostOutbox.length,
            1,
            'Should have 1 outbox entry for original post',
        );
        assert.equal(
            originalPostOutbox[0].outbox_type,
            OutboxType.Original,
            'Original post should have Original outbox type',
        );

        const reply = await fixtureManager.createReply(account, originalPost);

        const replyOutbox = await client('outboxes')
            .where({
                post_id: reply.id,
            })
            .select('*');
        assert.equal(
            replyOutbox.length,
            1,
            'Should have 1 outbox entry for reply',
        );
        assert.equal(
            replyOutbox[0].outbox_type,
            OutboxType.Reply,
            'Reply should have Reply outbox type',
        );

        // Add repost to the reply
        reply.addRepost(reposter);
        await postRepository.save(reply);

        const outboxAfterRepost = await client('outboxes')
            .where({
                post_id: reply.id,
            })
            .select('*');
        assert.equal(
            outboxAfterRepost.length,
            2,
            'Should have 2 outbox entries for reply (1 reply + 1 repost)',
        );

        // Verify repost entry
        const repostEntry = outboxAfterRepost.find(
            (entry) => entry.outbox_type === OutboxType.Repost,
        );
        assert(repostEntry, 'Should have repost entry');
        assert.equal(
            repostEntry.account_id,
            reposter.id,
            'Repost entry should be for reposter',
        );
        assert.equal(
            repostEntry.author_id,
            account.id,
            'Repost entry should have original author ID',
        );

        // Delete the reply
        reply.delete(account);
        await postRepository.save(reply);

        const outboxAfterDelete = await client('outboxes')
            .where({
                post_id: reply.id,
            })
            .select('*');
        assert.equal(
            outboxAfterDelete.length,
            0,
            'Should have no outbox entries for deleted reply',
        );

        const originalPostOutboxAfterDelete = await client('outboxes')
            .where({
                post_id: originalPost.id,
            })
            .select('*');
        assert.equal(
            originalPostOutboxAfterDelete.length,
            1,
            'Original post should still have its outbox entry',
        );
    });

    it('Does not create outbox entries for external accounts', async () => {
        const externalAccount = await fixtureManager.createExternalAccount();

        const post = await fixtureManager.createPost(externalAccount);

        const outboxEntry = await client('outboxes')
            .where({
                post_id: post.id,
            })
            .select('*')
            .first();

        assert(
            !outboxEntry,
            'No outbox entry should be created for external accounts',
        );
    });

    describe('Post Entity Mapping', () => {
        it('correctly maps a post row to a post entity', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const post = await fixtureManager.createPost(account);

            const retrievedPost = await postRepository.getById(post.id);
            assert(retrievedPost, 'Post should be retrieved from database');

            expect(retrievedPost.id).toBe(post.id);
            expect(retrievedPost.uuid).toBe(post.uuid);
            expect(retrievedPost.type).toBe(post.type);
            expect(retrievedPost.title).toBe(post.title);
            expect(retrievedPost.content).toBe(post.content);
            expect(retrievedPost.excerpt).toBe(post.excerpt);
            expect(retrievedPost.url.href).toBe(post.url.href);
            expect(retrievedPost.imageUrl?.href).toBe(post.imageUrl?.href);
            expect(retrievedPost.publishedAt.toISOString()).toBe(
                post.publishedAt.toISOString(),
            );
            expect(retrievedPost.metadata).toEqual(post.metadata);
            expect(retrievedPost.likeCount).toBe(0);
            expect(retrievedPost.repostCount).toBe(0);
            expect(retrievedPost.replyCount).toBe(0);
            expect(retrievedPost.readingTimeMinutes).toBe(
                post.readingTimeMinutes,
            );
            expect(Post.isDeleted(retrievedPost)).toBe(false);

            expect(retrievedPost.author.id).toBe(account.id);
            expect(retrievedPost.author.uuid).toBe(account.uuid);
            expect(retrievedPost.author.username).toBe(account.username);
            expect(retrievedPost.author.name).toBe(account.name);
            expect(retrievedPost.author.bio).toBe(account.bio);
            expect(retrievedPost.author.url.href).toBe(account.url.href);
            expect(retrievedPost.author.avatarUrl?.href).toBe(
                account.avatarUrl?.href,
            );
            expect(retrievedPost.author.bannerImageUrl?.href).toBe(
                account.bannerImageUrl?.href,
            );
            expect(retrievedPost.author.apId.href).toBe(account.apId.href);
            if (account.apFollowers) {
                expect(retrievedPost.author.apFollowers?.href).toBe(
                    account.apFollowers.href,
                );
            }
            if (account.apInbox) {
                expect(retrievedPost.author.apInbox?.href).toBe(
                    account.apInbox.href,
                );
            }
            expect(retrievedPost.author.isInternal).toBe(account.isInternal);

            expect(retrievedPost.attachments).toHaveLength(0);
            expect(retrievedPost.summary).toBe(post.summary);
            expect(retrievedPost.audience).toBe(post.audience);
            expect(retrievedPost.inReplyTo).toBe(post.inReplyTo);
            expect(retrievedPost.threadRoot).toBe(post.threadRoot);
        });

        it('handles missing author UUID by generating a new one', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            await client('accounts')
                .where({ id: account.id })
                .update({ uuid: null });

            const post = await fixtureManager.createPost(account);

            const retrievedPost = await postRepository.getById(post.id);
            assert(retrievedPost, 'Post should be retrieved from database');

            // Verify that a new UUID was generated for the author
            expect(retrievedPost.author.uuid).toBeDefined();
            expect(retrievedPost.author.uuid).not.toBe(account.uuid);

            // Verify that the UUID was saved in the database
            const updatedAccount = await client('accounts')
                .where({ id: account.id })
                .select('uuid')
                .first();
            expect(updatedAccount.uuid).toBe(retrievedPost.author.uuid);
        });

        it('correctly maps mentions for a post', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const post = await fixtureManager.createPost(account);

            const [mentionedAccount1] =
                await fixtureManager.createInternalAccount();
            const [mentionedAccount2] =
                await fixtureManager.createInternalAccount();

            await client('mentions').insert([
                {
                    post_id: post.id,
                    account_id: mentionedAccount1.id,
                },
                {
                    post_id: post.id,
                    account_id: mentionedAccount2.id,
                },
            ]);

            const retrievedPost = await postRepository.getById(post.id);
            assert(retrievedPost, 'Post should be retrieved from database');

            expect(retrievedPost.mentions).toHaveLength(2);
            expect(retrievedPost.mentions[0]).toEqual({
                id: mentionedAccount1.id,
                apId: mentionedAccount1.apId,
                username: mentionedAccount1.username,
            });
            expect(retrievedPost.mentions[1]).toEqual({
                id: mentionedAccount2.id,
                apId: mentionedAccount2.apId,
                username: mentionedAccount2.username,
            });
        });
    });

    describe('Post Updates', () => {
        it('should handle updating a post with new parameters', async () => {
            const site =
                await siteService.initialiseSiteForHost('testing-update.com');
            const account = await accountRepository.getBySite(site);

            // Original post
            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Original Title',
                uuid: randomUUID(),
                html: '<p>Original content</p>',
                excerpt: 'Original excerpt',
                custom_excerpt: 'Original summary',
                feature_image: 'https://example.com/original-image.jpg',
                url: 'https://testing-update.com/original-post',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [
                    {
                        name: 'Original Author',
                        profile_image:
                            'https://example.com/original-author.jpg',
                    },
                ],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            await postRepository.save(post);

            const originalRowInDb = await client('posts')
                .where({ uuid: post.uuid })
                .select('*')
                .first();

            expect(originalRowInDb.title).toBe('Original Title');
            expect(originalRowInDb.content).toBe('<p>Original content</p>');
            expect(originalRowInDb.excerpt).toBe('Original excerpt');
            expect(originalRowInDb.summary).toBe('Original summary');
            expect(originalRowInDb.image_url).toBe(
                'https://example.com/original-image.jpg',
            );
            expect(originalRowInDb.url).toBe(
                'https://testing-update.com/original-post',
            );
            expect(originalRowInDb.metadata).toEqual({
                ghostAuthors: [
                    {
                        name: 'Original Author',
                        profile_image:
                            'https://example.com/original-author.jpg',
                    },
                ],
            });

            const updateParams = {
                title: PostTitle.parse('Updated Title'),
                content: '<p>Updated content</p>',
                excerpt: PostSummary.parse('Updated excerpt'),
                summary: PostSummary.parse('Updated summary'),
                imageUrl: new URL('https://example.com/updated-image.jpg'),
                url: new URL('https://testing-update.com/updated-post'),
                metadata: {
                    ghostAuthors: [
                        {
                            name: 'Updated Author',
                            profile_image:
                                'https://example.com/updated-author.jpg',
                        },
                    ],
                },
            };

            post.update(account, updateParams);

            expect(post.isUpdateDirty).toBe(true);

            const eventsEmitSpy = vi.spyOn(events, 'emitAsync');
            await postRepository.save(post);

            expect(eventsEmitSpy).toHaveBeenCalledWith(
                PostUpdatedEvent.getName(),
                expect.objectContaining({
                    getPostId: expect.any(Function),
                }),
            );

            const emittedEvent = eventsEmitSpy.mock.calls.find(
                (call) => call[0] === PostUpdatedEvent.getName(),
            )?.[1] as PostUpdatedEvent | undefined;
            expect(emittedEvent?.getPostId()).toEqual(post.id);

            const updatedRowInDb = await client('posts')
                .where({ uuid: post.uuid })
                .select('*')
                .first();

            expect(updatedRowInDb.title).toBe('Updated Title');
            expect(updatedRowInDb.content).toBe('<p>Updated content</p>');
            expect(updatedRowInDb.excerpt).toBe('Updated excerpt');
            expect(updatedRowInDb.summary).toBe('Updated summary');
            expect(updatedRowInDb.image_url).toBe(
                'https://example.com/updated-image.jpg',
            );
            expect(updatedRowInDb.url).toBe(
                'https://testing-update.com/updated-post',
            );
            expect(updatedRowInDb.metadata).toEqual({
                ghostAuthors: [
                    {
                        name: 'Updated Author',
                        profile_image: 'https://example.com/updated-author.jpg',
                    },
                ],
            });

            expect(
                new Date(updatedRowInDb.updated_at).getTime(),
            ).toBeGreaterThan(new Date(originalRowInDb.updated_at).getTime());

            expect(post.isUpdateDirty).toBe(false);
        });

        it('should not update database if no updated parameters are provided', async () => {
            const site = await siteService.initialiseSiteForHost(
                'testing-no-update.com',
            );
            const account = await accountRepository.getBySite(site);

            const postResult = await Post.createArticleFromGhostPost(account, {
                title: 'Original Title',
                uuid: randomUUID(),
                html: '<p>Original content</p>',
                excerpt: 'Original excerpt',
                custom_excerpt: null,
                feature_image: null,
                url: 'https://testing-no-update.com/original-post',
                published_at: '2025-01-01',
                visibility: 'public',
                authors: [],
            });
            const post = getValue(postResult as Ok<Post>) as Post;

            await postRepository.save(post);

            const originalRowInDb = await client('posts')
                .where({ uuid: post.uuid })
                .select('*')
                .first();

            expect(post.isUpdateDirty).toBe(false);

            const eventsEmitSpy = vi.spyOn(events, 'emitAsync');
            await postRepository.save(post);

            expect(eventsEmitSpy).not.toHaveBeenCalled();

            const afterSaveRowInDb = await client('posts')
                .where({ uuid: post.uuid })
                .select('*')
                .first();

            expect(afterSaveRowInDb.updated_at).toEqual(
                originalRowInDb.updated_at,
            );
            expect(afterSaveRowInDb.title).toBe(originalRowInDb.title);
            expect(afterSaveRowInDb.content).toBe(originalRowInDb.content);
        });
    });

    describe('dirty flag behavior', () => {
        it('should not update external post counts when dirty flags are false', async () => {
            const externalAccount =
                await fixtureManager.createExternalAccount();
            const post = Post.createFromData(externalAccount, {
                type: PostType.Note,
                content: 'External post content',
                apId: new URL('https://external.com/post/1'),
            });

            await postRepository.save(post);
            assert(post.id, 'Post should have an ID after saving');

            const initialRow = await client('posts')
                .where({ id: post.id })
                .select('like_count', 'repost_count', 'updated_at')
                .first();

            await new Promise((resolve) => setTimeout(resolve, 10));

            await postRepository.save(post);

            const afterRow = await client('posts')
                .where({ id: post.id })
                .select('like_count', 'repost_count', 'updated_at')
                .first();

            expect(afterRow.like_count).toBe(initialRow.like_count);
            expect(afterRow.repost_count).toBe(initialRow.repost_count);
            expect(afterRow.updated_at).toEqual(initialRow.updated_at);
        });

        it('should update external post like count only when dirty flag is set', async () => {
            const externalAccount =
                await fixtureManager.createExternalAccount();
            const post = Post.createFromData(externalAccount, {
                type: PostType.Note,
                content: 'External post content',
                apId: new URL('https://external.com/post/2'),
            });

            await postRepository.save(post);
            assert(post.id, 'Post should have an ID after saving');

            post.setLikeCount(42);
            expect(post.isLikeCountDirty).toBe(true);

            await postRepository.save(post);

            const row = await client('posts')
                .where({ id: post.id })
                .select('like_count', 'repost_count')
                .first();

            expect(row.like_count).toBe(42);
            expect(row.repost_count).toBe(0);

            expect(post.isLikeCountDirty).toBe(false);
        });

        it('should update external post repost count only when dirty flag is set', async () => {
            const externalAccount =
                await fixtureManager.createExternalAccount();
            const post = Post.createFromData(externalAccount, {
                type: PostType.Note,
                content: 'External post content',
                apId: new URL('https://external.com/post/3'),
            });

            await postRepository.save(post);
            assert(post.id, 'Post should have an ID after saving');

            post.setRepostCount(15);
            expect(post.isRepostCountDirty).toBe(true);

            await postRepository.save(post);

            const row = await client('posts')
                .where({ id: post.id })
                .select('like_count', 'repost_count')
                .first();

            expect(row.like_count).toBe(0);
            expect(row.repost_count).toBe(15);

            expect(post.isRepostCountDirty).toBe(false);
        });

        it('should update both counts when both dirty flags are set', async () => {
            const externalAccount =
                await fixtureManager.createExternalAccount();
            const post = Post.createFromData(externalAccount, {
                type: PostType.Note,
                content: 'External post content',
                apId: new URL('https://external.com/post/4'),
            });

            await postRepository.save(post);
            assert(post.id, 'Post should have an ID after saving');

            post.setLikeCount(100);
            post.setRepostCount(50);
            expect(post.isLikeCountDirty).toBe(true);
            expect(post.isRepostCountDirty).toBe(true);

            await postRepository.save(post);

            const row = await client('posts')
                .where({ id: post.id })
                .select('like_count', 'repost_count')
                .first();

            expect(row.like_count).toBe(100);
            expect(row.repost_count).toBe(50);

            expect(post.isLikeCountDirty).toBe(false);
            expect(post.isRepostCountDirty).toBe(false);
        });

        it('should clear dirty flags after successful save', async () => {
            const externalAccount =
                await fixtureManager.createExternalAccount();
            const post = Post.createFromData(externalAccount, {
                type: PostType.Note,
                content: 'External post content',
                apId: new URL('https://external.com/post/5'),
            });

            await postRepository.save(post);
            assert(post.id, 'Post should have an ID after saving');

            post.setLikeCount(99);
            post.setRepostCount(33);
            expect(post.isLikeCountDirty).toBe(true);
            expect(post.isRepostCountDirty).toBe(true);

            await postRepository.save(post);

            expect(post.isLikeCountDirty).toBe(false);
            expect(post.isRepostCountDirty).toBe(false);

            const row = await client('posts')
                .where({ id: post.id })
                .select('like_count', 'repost_count')
                .first();

            expect(row.like_count).toBe(99);
            expect(row.repost_count).toBe(33);
        });
    });

    it('should handle concurrent updates to the repost count', async () => {
        const authorAccount = await fixtureManager.createExternalAccount();
        const reposterAccount = await fixtureManager.createExternalAccount();

        const post = await fixtureManager.createPost(authorAccount);

        // Simulate concurrency by creating a clone of the existing post
        const postClone = new Post(
            post.id,
            post.uuid,
            authorAccount,
            post.type,
            post.audience,
            post.title,
            post.excerpt,
            post.summary,
            post.content,
            post.url,
            post.imageUrl,
            post.publishedAt,
            post.metadata,
            post.likeCount,
            post.repostCount,
            post.replyCount,
            post.inReplyTo,
            post.threadRoot,
            null,
            post.attachments,
            post.apId,
            false,
            post.updatedAt,
        );

        expect(postClone).toEqual(post);

        // Add a repost to the original post and save
        post.addRepost(reposterAccount);
        await postRepository.save(post);

        // Remove the repost from the clone and attempt to save - because the
        // cloned post has a repost count of 0 (as its not aware of the repost
        // on the original post). If we are handling concurrency correctly,
        // this should not throw an error as we use an atomic update to update
        // the repost count
        postClone.removeRepost(reposterAccount);
        await expect(
            postRepository.save(postClone),
        ).resolves.not.toThrowError();

        const postRow = await client('posts').where({ id: post.id }).first();

        expect(postRow.repost_count).toBe(0);
    });
});
