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
import { Audience, PostType } from '../post/post.entity';
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
        it("should add to the user's feed and any follower feeds if the post audience is: Public or FollowersOnly", async () => {
            const feedService = new FeedService(client, events);

            // Initialise user internal account
            const fooSite = await siteService.initialiseSiteForHost('foo.com');
            const fooAccount = await accountRepository.getBySite(fooSite);

            // Initialise an internal account that the user will follow
            const barSite = await siteService.initialiseSiteForHost('bar.com');
            const barAccount = await accountRepository.getBySite(barSite);

            await accountService.recordAccountFollow(
                barAccount as unknown as AccountType,
                fooAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will not follow
            const bazSite = await siteService.initialiseSiteForHost('baz.com');
            const bazAccount = await accountRepository.getBySite(bazSite);

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
            const fooAccountPost = Post.createFromData(fooAccount, {
                type: PostType.Article,
                audience: Audience.Public,
                title: 'Foo Account Post',
                excerpt: 'Hello, world! (from foo.com)',
                content: '<p>Hello, world! (from foo.com)</p>',
                url: new URL('https://foo.com/hello-world'),
                imageUrl: null,
                publishedAt: new Date('2025-01-01'),
            });

            const barAccountPost = Post.createFromData(barAccount, {
                type: PostType.Article,
                audience: Audience.FollowersOnly,
                title: 'Bar Account Post',
                excerpt: 'Hello, world! (from bar.com)',
                content: '<p>Hello, world! (from bar.com)</p>',
                url: new URL('https://bar.com/hello-world'),
                imageUrl: null,
                publishedAt: new Date('2025-01-02'),
            });

            const bazAccountPost = Post.createFromData(bazAccount, {
                type: PostType.Article,
                audience: Audience.Public,
                title: 'Baz Account Post',
                excerpt: 'Hello, world! (from baz.com)',
                content: '<p>Hello, world! (from baz.com)</p>',
                url: new URL('https://baz.com/hello-world'),
                imageUrl: null,
                publishedAt: new Date('2025-01-03'),
            });

            await postRepository.save(fooAccountPost);
            await waitForPostAddedToFeeds(fooAccountPost);

            await postRepository.save(barAccountPost);
            await waitForPostAddedToFeeds(barAccountPost);

            await postRepository.save(bazAccountPost);
            await waitForPostAddedToFeeds(bazAccountPost);

            // fooAccount should have 2 posts in their feed - Their own and barAccount's
            // (because fooAccount follows barAccount)
            const fooFeed = await client('feeds')
                .join('users', 'users.id', 'feeds.user_id')
                .join('accounts', 'accounts.id', 'users.account_id')
                .where('accounts.id', fooAccount.id);

            expect(fooFeed.length).toBe(2);
            expect(fooFeed[0]).toMatchObject({
                post_type: fooAccountPost.type,
                audience: fooAccountPost.audience,
                post_id: fooAccountPost.id,
                author_id: fooAccount.id,
            });
            expect(fooFeed[1]).toMatchObject({
                post_type: barAccountPost.type,
                audience: barAccountPost.audience,
                post_id: barAccountPost.id,
                author_id: barAccount.id,
            });

            // barAccount should have 1 post in their feed - Their own
            // (because they do not follow anyone)
            const barFeed = await client('feeds')
                .join('users', 'users.id', 'feeds.user_id')
                .join('accounts', 'accounts.id', 'users.account_id')
                .where('accounts.id', barAccount.id);
            expect(barFeed.length).toBe(1);
            expect(barFeed[0]).toMatchObject({
                post_type: barAccountPost.type,
                audience: barAccountPost.audience,
                post_id: barAccountPost.id,
                author_id: barAccount.id,
            });

            // bazAccount should have 1 posts in their feed - Their own
            // (because they do not follow anyone)
            const bazFeed = await client('feeds')
                .join('users', 'users.id', 'feeds.user_id')
                .join('accounts', 'accounts.id', 'users.account_id')
                .where('accounts.id', bazAccount.id);
            expect(bazFeed.length).toBe(1);
            expect(bazFeed[0]).toMatchObject({
                post_type: bazAccountPost.type,
                audience: bazAccountPost.audience,
                post_id: bazAccountPost.id,
                author_id: bazAccount.id,
            });
        }, 10000);
    });
});
