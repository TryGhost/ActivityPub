import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';

import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import type { Account as AccountType } from '../account/types';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import {
    TABLE_ACCOUNTS,
    TABLE_FEEDS,
    TABLE_FOLLOWS,
    TABLE_POSTS,
    TABLE_SITES,
    TABLE_USERS,
} from '../constants';
import { client } from '../db';
import { Post } from '../post/post.entity';
import { KnexPostRepository } from '../post/post.repository.knex';
import { SiteService } from '../site/site.service';
import { FeedService } from './feed.service';
import {
    FeedsUpdatedEvent,
    FeedsUpdatedEventUpdateOperation,
} from './feeds-updated.event';

describe('FeedService', () => {
    let events: EventEmitter;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;
    let postRepository: KnexPostRepository;

    const waitForPostAddedToFeeds = (post: Post) => {
        return new Promise<void>((resolve) => {
            events.on(
                FeedsUpdatedEvent.getName(),
                (event: FeedsUpdatedEvent) => {
                    if (
                        event.post.id === post.id &&
                        event.updateOperation ===
                            FeedsUpdatedEventUpdateOperation.PostAdded
                    ) {
                        resolve();
                    }
                },
            );
        });
    };

    beforeEach(async () => {
        // Clean up the database
        await client.raw('SET FOREIGN_KEY_CHECKS = 0');
        await client(TABLE_FEEDS).truncate();
        await client(TABLE_POSTS).truncate();
        await client(TABLE_FOLLOWS).truncate();
        await client(TABLE_ACCOUNTS).truncate();
        await client(TABLE_USERS).truncate();
        await client(TABLE_SITES).truncate();
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
                        title: `Site ${host} title`,
                        description: `Site ${host} description`,
                        icon: `https://${host}/favicon.ico`,
                    },
                };
            },
        });
        postRepository = new KnexPostRepository(client, events);
    });

    describe('handling a post being created', () => {
        it("should add to the user's feed and any follower feeds if the post audience is: Public", async () => {
            const feedService = new FeedService(client, events, accountService);

            // Initialise user internal account
            const fooSite = await siteService.initialiseSiteForHost('foo.com');
            const fooAccount = await accountRepository.getBySite(fooSite);
            const fooUserId = await accountService.getInternalIdForAccount(
                fooAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow
            const barSite = await siteService.initialiseSiteForHost('bar.com');
            const barAccount = await accountRepository.getBySite(barSite);
            const barUserId = await accountService.getInternalIdForAccount(
                barAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                barAccount as unknown as AccountType,
                fooAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will not follow
            const bazSite = await siteService.initialiseSiteForHost('baz.com');
            const bazAccount = await accountRepository.getBySite(bazSite);
            const bazUserId = await accountService.getInternalIdForAccount(
                bazAccount as unknown as AccountType,
            );

            // Initialise an external account that follows the user - This account
            // should not have a feed so we should not try and add a post to it.
            // If we did, an error would be thrown and the test would fail.
            // @TODO: Is there a better way to test this?
            const quxAccount = await accountService.createExternalAccount({
                username: 'external-account',
                name: 'External Account',
                bio: 'External Account Bio',
                avatar_url: 'https://example.com/avatars/external-account.png',
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

            await accountService.recordAccountFollow(
                fooAccount as unknown as AccountType,
                quxAccount as unknown as AccountType,
            );

            // Create posts
            const fooAccountPost = Post.createArticleFromGhostPost(fooAccount, {
                title: 'Title',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://foo.com/hello-world',
                published_at: '2025-01-01',
            });

            const barAccountPost = Post.createArticleFromGhostPost(barAccount, {
                title: 'Title',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://bar.com/hello-world',
                published_at: '2025-01-01',
            });

            const bazAccountPost = Post.createArticleFromGhostPost(bazAccount, {
                title: 'Title',
                html: '<p>Hello, world!</p>',
                excerpt: 'Hello, world!',
                feature_image: null,
                url: 'https://baz.com/hello-world',
                published_at: '2025-01-01',
            });

            await postRepository.save(fooAccountPost);
            await waitForPostAddedToFeeds(fooAccountPost);

            await postRepository.save(barAccountPost);
            await waitForPostAddedToFeeds(barAccountPost);

            await postRepository.save(bazAccountPost);
            await waitForPostAddedToFeeds(bazAccountPost);

            // fooAccount should have 2 posts in their feed - Their own and barAccount's
            // (because fooAccount follows barAccount)
            const fooFeed = await client(TABLE_FEEDS).where(
                'user_id',
                fooUserId,
            );

            expect(fooFeed.length).toBe(2);
            expect(fooFeed[0]).toMatchObject({
                post_type: fooAccountPost.type,
                audience: fooAccountPost.audience,
                user_id: fooUserId,
                post_id: fooAccountPost.id,
                author_id: fooAccount.id,
            });
            expect(fooFeed[1]).toMatchObject({
                post_type: barAccountPost.type,
                audience: barAccountPost.audience,
                user_id: fooUserId,
                post_id: barAccountPost.id,
                author_id: barAccount.id,
            });

            // barAccount should have 1 post in their feed - Their own
            // (because they do not follow anyone)
            const barFeed = await client(TABLE_FEEDS).where(
                'user_id',
                barUserId,
            );
            expect(barFeed.length).toBe(1);
            expect(barFeed[0]).toMatchObject({
                post_type: barAccountPost.type,
                audience: barAccountPost.audience,
                user_id: barUserId,
                post_id: barAccountPost.id,
                author_id: barAccount.id,
            });

            // bazAccount should have 1 posts in their feed - Their own
            // (because they do not follow anyone)
            const bazFeed = await client(TABLE_FEEDS).where(
                'user_id',
                bazUserId,
            );
            expect(bazFeed.length).toBe(1);
            expect(bazFeed[0]).toMatchObject({
                post_type: bazAccountPost.type,
                audience: bazAccountPost.audience,
                user_id: bazUserId,
                post_id: bazAccountPost.id,
                author_id: bazAccount.id,
            });
        });

        it.skip('should only add to follower feeds if the post audience is: FollowersOnly', async () => {
            // @TODO: Implement
        });

        it.skip('should not add to any feeds if the post audience is: Direct', async () => {
            // @TODO: Implement
        });
    });
});
