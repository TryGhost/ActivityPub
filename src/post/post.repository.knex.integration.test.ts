import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { AsyncEvents } from 'core/events';
import { FeedUpdateService } from 'feed/feed-update.service';
import { FeedService } from 'feed/feed.service';
import type { Knex } from 'knex';
import { createTestDb } from 'test/db';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { TABLE_LIKES, TABLE_POSTS, TABLE_REPOSTS } from '../constants';
import { SiteService } from '../site/site.service';
import { PostCreatedEvent } from './post-created.event';
import { PostDeletedEvent } from './post-deleted.event';
import { PostDerepostedEvent } from './post-dereposted.event';
import { PostRepostedEvent } from './post-reposted.event';
import { Post, PostType } from './post.entity';
import { KnexPostRepository } from './post.repository.knex';

describe('KnexPostRepository', () => {
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;
    let postRepository: KnexPostRepository;
    let client: Knex;

    const getAccount = async (host: string) => {
        const site = await siteService.initialiseSiteForHost(host);
        const account = await accountRepository.getBySite(site);

        return account;
    };

    beforeAll(async () => {
        client = await createTestDb();
    });

    beforeEach(async () => {
        // Clean up the database
        await client.raw('SET FOREIGN_KEY_CHECKS = 0');
        await client(TABLE_REPOSTS).truncate();
        await client(TABLE_LIKES).truncate();
        await client(TABLE_POSTS).truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Init dependencies
        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(client, events);
        fedifyContextFactory = new FedifyContextFactory();
        accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
        );
        siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });
        postRepository = new KnexPostRepository(client, events);
        const feedService = new FeedService(client);
        const feedUpdateService = new FeedUpdateService(events, feedService);
        feedUpdateService.init();
    });

    describe('Events', () => {
        it('Waits for the post to be added to feeds before returning', async () => {
            const site = await siteService.initialiseSiteForHost('testing.com');
            const account = await accountRepository.getBySite(site);
            const post = Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
            });

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
            const post = Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
            });

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
            const post = Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
            });

            await postRepository.save(post);

            post.delete(account);

            const postDeletedEventPromise: Promise<PostDeletedEvent> =
                new Promise((resolve) => {
                    events.once(PostDeletedEvent.getName(), resolve);
                });

            await postRepository.save(post);

            const rowInDb = await client(TABLE_POSTS)
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
            const post = Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: '3f1c5e84-9a2b-4d7f-8e62-1a6b9c9d4f10',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
            });

            await postRepository.save(post);

            const reply = Post.createFromData(account, {
                type: PostType.Note,
                content: 'Hey',
                inReplyTo: post,
            });

            await postRepository.save(reply);

            const postRowInDb = await client(TABLE_POSTS)
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

            const replyRowInDb = await client(TABLE_POSTS)
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

            const postRowAfterDelete = await client(TABLE_POSTS)
                .where({
                    uuid: post.uuid,
                })
                .select('*')
                .first();

            expect(postRowAfterDelete.reply_count).toBe(0);
        });

        it('Can handle a new deleted post', async () => {
            const site = await siteService.initialiseSiteForHost(
                'testing-new-deleted.com',
            );
            const account = await accountRepository.getBySite(site);
            const post = Post.createArticleFromGhostPost(account, {
                title: 'Title',
                uuid: randomUUID(),
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://testing.com/hello-world',
                published_at: '2025-01-01',
                visibility: 'public',
            });

            post.delete(account);

            await postRepository.save(post);

            const rowInDb = await client(TABLE_POSTS)
                .where({
                    uuid: post.uuid,
                })
                .select('*')
                .first();

            expect(rowInDb).toBe(undefined);
        });
    });

    it('Can save a Post', async () => {
        const site =
            await siteService.initialiseSiteForHost('testing-saving.com');
        const account = await accountRepository.getBySite(site);
        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        await postRepository.save(post);

        const rowInDb = await client(TABLE_POSTS)
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
    });

    it('Emits a PostCreatedEvent when a Post is saved', async () => {
        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');
        const site = await siteService.initialiseSiteForHost(
            'testing-post-created-event.com',
        );
        const account = await accountRepository.getBySite(site);

        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        await postRepository.save(post);

        expect(eventsEmitSpy).toHaveBeenCalledWith(
            PostCreatedEvent.getName(),
            new PostCreatedEvent(post),
        );
    });

    it('Does not emit a PostCreatedEvent when a Post is updated', async () => {
        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');
        const site = await siteService.initialiseSiteForHost(
            'testing-post-update.com',
        );
        const account = await accountRepository.getBySite(site);

        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        await postRepository.save(post);
        await postRepository.save(post);

        expect(eventsEmitSpy).toHaveBeenCalledTimes(1);
    });

    it('Can get by apId', async () => {
        const site = await siteService.initialiseSiteForHost(
            'testing-by-apid.com',
        );
        const account = await accountRepository.getBySite(site);
        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        await postRepository.save(post);

        const result = await postRepository.getByApId(post.apId);

        assert(result);

        assert(result.author.uuid === account.uuid);
        assert(result.uuid === post.uuid);
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

        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

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
        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

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

        const post = Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        post.addLike(accounts[0]);
        post.addLike(accounts[1]);
        post.addLike(accounts[2]);

        await postRepository.save(post);

        const rowInDb = await client(TABLE_POSTS)
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
        assert.equal(rowInDb.like_count, 3, 'There should be 3 likes');

        const likesInDb = await client(TABLE_LIKES)
            .where({
                post_id: post.id,
            })
            .select('*');

        assert.equal(likesInDb.length, 3, 'There should be 3 likes in the DB');
    });

    it('Handles likes and unlikes of an existing post', async () => {
        const accounts = await Promise.all(
            [
                'testing-unlikes-one.com',
                'testing-unlikes-two.com',
                'testing-unlikes-three.com',
            ].map(getAccount),
        );

        const post = Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        post.addLike(accounts[1]);

        await postRepository.save(post);

        post.addLike(accounts[0]);
        post.addLike(accounts[1]);

        await postRepository.save(post);

        post.addLike(accounts[0]);
        post.addLike(accounts[2]);
        post.removeLike(accounts[1]);

        await postRepository.save(post);

        const rowInDb = await client(TABLE_POSTS)
            .where({
                uuid: post.uuid,
            })
            .select('like_count')
            .first();

        assert.equal(rowInDb.like_count, 2, 'There should be 2 likes');
    });

    it('Handles reposts of a new post', async () => {
        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');
        const accounts = await Promise.all(
            [
                'testing-reposts-one.com',
                'testing-reposts-two.com',
                'testing-reposts-three.com',
            ].map(getAccount),
        );

        const post = Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        post.addRepost(accounts[1]);
        post.addRepost(accounts[2]);

        await postRepository.save(post);

        const rowInDb = await client(TABLE_POSTS)
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
        assert.equal(rowInDb.repost_count, 2, 'There should be 2 reposts');

        const repostsInDb = await client(TABLE_REPOSTS)
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
            new PostRepostedEvent(post, Number(accounts[1].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            3,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(post, Number(accounts[2].id)),
        );
    });

    it('Handles reposts and dereposts of an existing post', async () => {
        const eventsEmitSpy = vi.spyOn(events, 'emitAsync');
        const accounts = await Promise.all(
            [
                'testing-derepost-one.com',
                'testing-derepost-two.com',
                'testing-derepost-three.com',
            ].map(getAccount),
        );

        const post = Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            uuid: randomUUID(),
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
            visibility: 'public',
        });

        post.addRepost(accounts[1]);

        await postRepository.save(post);

        post.addRepost(accounts[0]);
        post.addRepost(accounts[1]);

        await postRepository.save(post);

        post.addRepost(accounts[0]);
        post.addRepost(accounts[2]);
        post.removeRepost(accounts[1]);

        await postRepository.save(post);

        const rowInDb = await client(TABLE_POSTS)
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
            new PostRepostedEvent(post, Number(accounts[1].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            3,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(post, Number(accounts[0].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            4,
            PostRepostedEvent.getName(),
            new PostRepostedEvent(post, Number(accounts[2].id)),
        );
        expect(eventsEmitSpy).nthCalledWith(
            5,
            PostDerepostedEvent.getName(),
            new PostDerepostedEvent(post, Number(accounts[1].id)),
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

        const originalPost = Post.createArticleFromGhostPost(accounts[0], {
            title: 'Original Post',
            uuid: randomUUID(),
            html: '<p>Original content</p>',
            excerpt: 'Original content',
            feature_image: null,
            url: 'https://testing.com/original-post',
            published_at: '2025-01-01',
            visibility: 'public',
        });

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

        const rowInDb = await client(TABLE_POSTS)
            .where({
                uuid: originalPost.uuid,
            })
            .select('reply_count')
            .first();

        assert.equal(rowInDb.reply_count, 3, 'There should be 3 replies');

        const repliesInDb = await client(TABLE_POSTS)
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
});
