import assert from 'node:assert';
import EventEmitter from 'node:events';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { TABLE_LIKES, TABLE_POSTS } from '../constants';
import { client } from '../db';
import { SiteService } from '../site/site.service';
import { PostCreatedEvent } from './post-created.event';
import { Post } from './post.entity';
import { KnexPostRepository } from './post.repository.knex';

afterAll(async () => {
    await client.destroy();
});

describe('KnexPostRepository', () => {
    let events: EventEmitter;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;

    beforeEach(async () => {
        // Clean up the database
        await client.raw('SET FOREIGN_KEY_CHECKS = 0');
        await client(TABLE_LIKES).truncate();
        await client(TABLE_POSTS).truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Init dependencies
        events = new EventEmitter();
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
    });

    it('Can save a Post', async () => {
        const postRepository = new KnexPostRepository(client, events);

        const site = await siteService.initialiseSiteForHost('testing.com');
        const account = await accountRepository.getBySite(site);

        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
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

    it('Emits a PostCreatedEvent when a Post is saved', async () => {
        const eventsEmitSpy = vi.spyOn(events, 'emit');

        const postRepository = new KnexPostRepository(client, events);

        const site = await siteService.initialiseSiteForHost('testing.com');
        const account = await accountRepository.getBySite(site);

        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
        });

        await postRepository.save(post);

        expect(eventsEmitSpy).toHaveBeenCalledWith(
            PostCreatedEvent.getName(),
            new PostCreatedEvent(post),
        );
    });

    it('Can get by apId', async () => {
        const postRepository = new KnexPostRepository(client, events);

        const site = await siteService.initialiseSiteForHost('testing.com');
        const account = await accountRepository.getBySite(site);

        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
        });

        await postRepository.save(post);

        const result = await postRepository.getByApId(post.apId);

        assert(result);
    });

    it('Handles likes of a new post', async () => {
        const postRepository = new KnexPostRepository(client, events);

        async function getAccount(host: string) {
            const site = await siteService.initialiseSiteForHost(host);
            const account = await accountRepository.getBySite(site);

            return account;
        }

        const accounts = await Promise.all(
            ['testing-one.com', 'testing-two.com', 'testing-three.com'].map(
                getAccount,
            ),
        );

        const post = Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
        });

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

        const likesInDb = await client('likes')
            .where({
                post_id: post.id,
            })
            .select('*');

        assert.equal(likesInDb.length, 3, 'There should be 3 likes in the DB');
    });

    it('Handles likes of an existing post', async () => {
        const postRepository = new KnexPostRepository(client, events);

        async function getAccount(host: string) {
            const site = await siteService.initialiseSiteForHost(host);
            const account = await accountRepository.getBySite(site);

            return account;
        }

        const accounts = await Promise.all(
            ['testing-one.com', 'testing-two.com', 'testing-three.com'].map(
                getAccount,
            ),
        );

        const post = Post.createArticleFromGhostPost(accounts[0], {
            title: 'Title',
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
        });

        post.addLike(accounts[1]);

        await postRepository.save(post);

        post.addLike(accounts[0]);
        post.addLike(accounts[1]);

        await postRepository.save(post);

        post.addLike(accounts[0]);
        post.addLike(accounts[2]);

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('like_count')
            .first();

        assert.equal(rowInDb.like_count, 3, 'There should be 3 likes');
    });
});
