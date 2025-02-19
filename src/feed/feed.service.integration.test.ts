import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Account } from '../account/account.entity';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import type { Account as AccountType, Site } from '../account/types';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import {
    TABLE_ACCOUNTS,
    TABLE_FEEDS,
    TABLE_FOLLOWS,
    TABLE_POSTS,
    TABLE_REPOSTS,
    TABLE_SITES,
    TABLE_USERS,
} from '../constants';
import { client } from '../db';
import { Audience, type PostData, PostType } from '../post/post.entity';
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

    const accountSitesMap: Map<number, Site> = new Map();
    const createInternalAccount = async (host: string) => {
        const site = await siteService.initialiseSiteForHost(host);
        const account = await accountRepository.getBySite(site);

        accountSitesMap.set(Number(account.id), site);

        return account;
    };

    let externalAccountCount = 0;
    const createExternalAccount = async (host: string) => {
        externalAccountCount++;

        const account = await accountService.createExternalAccount({
            username: `external-account-${externalAccountCount}-${host}`,
            name: `External Account ${externalAccountCount} ${host}`,
            bio: `External Account Bio ${externalAccountCount} ${host}`,
            avatar_url: `https://${host}/avatars/external-account-${externalAccountCount}.png`,
            banner_image_url: `https://${host}/banners/external-account-${externalAccountCount}.png`,
            url: `https://${host}/users/external-account-${externalAccountCount}`,
            custom_fields: {},
            ap_id: `https://${host}/activitypub/users/external-account-${externalAccountCount}`,
            ap_inbox_url: `https://${host}/activitypub/inbox/external-account-${externalAccountCount}`,
            ap_outbox_url: `https://${host}/activitypub/outbox/external-account-${externalAccountCount}`,
            ap_following_url: `https://${host}/activitypub/following/external-account-${externalAccountCount}`,
            ap_followers_url: `https://${host}/activitypub/followers/external-account-${externalAccountCount}`,
            ap_liked_url: `https://${host}/activitypub/liked/external-account-${externalAccountCount}`,
            ap_shared_inbox_url: null,
            ap_public_key: '',
        });

        return account;
    };

    let postCount = 0;
    const createPost = async (account: Account, data: Partial<PostData>) => {
        postCount++;

        const site = accountSitesMap.get(Number(account.id)) ?? {
            host: 'unknown',
        };

        const post = Post.createFromData(account, {
            type: PostType.Article,
            audience: Audience.Public,
            title: `Post ${postCount}`,
            excerpt: `Post ${postCount} excerpt`,
            content: `Post ${postCount} content`,
            url: new URL(`https://${site.host}/post-${postCount}`),
            imageUrl: null,
            publishedAt: new Date('2025-01-01'),
            ...data,
        });

        return post;
    };

    const getFeedForAccount = async (account: Account) => {
        const feed = await client(TABLE_FEEDS)
            .join(TABLE_USERS, `${TABLE_USERS}.id`, `${TABLE_FEEDS}.user_id`)
            .join(
                TABLE_ACCOUNTS,
                `${TABLE_ACCOUNTS}.id`,
                `${TABLE_USERS}.account_id`,
            )
            .where(`${TABLE_ACCOUNTS}.id`, account.id);

        return feed;
    };

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
        await client(TABLE_REPOSTS).truncate();
        await client(TABLE_POSTS).truncate();
        await client(TABLE_FOLLOWS).truncate();
        await client(TABLE_ACCOUNTS).truncate();
        await client(TABLE_USERS).truncate();
        await client(TABLE_SITES).truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Reset test state
        accountSitesMap.clear();
        externalAccountCount = 0;
        postCount = 0;

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
        it("should add to the user's feed, the reply target authors feed, and any follower feeds if the post audience is: Public or FollowersOnly", async () => {
            const feedService = new FeedService(client, events);

            // Initialise user internal account
            const userAccount = await createInternalAccount('foo.com');

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount('bar.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will not follow
            const unfollowedAccount = await createInternalAccount('baz.com');

            // Initialise an external account that follows the user - This account
            // should not have a feed so we should not try and add a post to it.
            // If we did, an error would be thrown and the test would fail.
            // @TODO: Is there a better way to test this?
            const externalAccount = await createExternalAccount('qux.com');

            await accountService.recordAccountFollow(
                userAccount as unknown as AccountType, // @TODO: Update this when AccountEntity is used everywhere
                externalAccount,
            );

            // Create posts
            const userAccountPost = await createPost(userAccount, {
                audience: Audience.Public,
            });

            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.FollowersOnly,
            });

            const unfollowedAccountPost = await createPost(unfollowedAccount, {
                audience: Audience.Public,
            });

            const unfollowedAccountReply = await createPost(unfollowedAccount, {
                type: PostType.Note,
                audience: Audience.Public,
                content: `This is a reply to ${userAccountPost.title}`,
                inReplyTo: userAccountPost,
            });

            await postRepository.save(userAccountPost);
            await waitForPostAddedToFeeds(userAccountPost);

            await postRepository.save(followedAccountPost);
            await waitForPostAddedToFeeds(followedAccountPost);

            await postRepository.save(unfollowedAccountPost);
            await waitForPostAddedToFeeds(unfollowedAccountPost);

            await postRepository.save(unfollowedAccountReply);
            await waitForPostAddedToFeeds(unfollowedAccountReply);

            // Assert feeds for each account are as expected

            // userAccount should have 3 posts in their feed:
            // - Their own
            // - followedAccount's post (because userAccount follows followedAccount)
            // - unfollowedAccount's reply (because userAccount's post was replied
            //   to in unfollowedAccount's reply post)
            const userAccountFeed = await getFeedForAccount(userAccount);

            expect(userAccountFeed.length).toBe(3);
            expect(userAccountFeed[0]).toMatchObject({
                post_type: userAccountPost.type,
                audience: userAccountPost.audience,
                post_id: userAccountPost.id,
                author_id: userAccount.id,
                reposted_by_id: null,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_type: followedAccountPost.type,
                audience: followedAccountPost.audience,
                post_id: followedAccountPost.id,
                author_id: followedAccount.id,
                reposted_by_id: null,
            });
            expect(userAccountFeed[2]).toMatchObject({
                post_type: unfollowedAccountReply.type,
                audience: unfollowedAccountReply.audience,
                post_id: unfollowedAccountReply.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: null,
            });

            // followedAccount should have 1 post in their feed:
            // - Their own (because they do not follow anyone)
            const followedAccountFeed =
                await getFeedForAccount(followedAccount);
            expect(followedAccountFeed.length).toBe(1);
            expect(followedAccountFeed[0]).toMatchObject({
                post_type: followedAccountPost.type,
                audience: followedAccountPost.audience,
                post_id: followedAccountPost.id,
                author_id: followedAccount.id,
                reposted_by_id: null,
            });

            // unfollowedAccount should have 2 posts in their feed:
            // - Their own (because they do not follow anyone)
            const unfollowedAccountFeed =
                await getFeedForAccount(unfollowedAccount);
            expect(unfollowedAccountFeed.length).toBe(2);
            expect(unfollowedAccountFeed[0]).toMatchObject({
                post_type: unfollowedAccountPost.type,
                audience: unfollowedAccountPost.audience,
                post_id: unfollowedAccountPost.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: null,
            });
            expect(unfollowedAccountFeed[1]).toMatchObject({
                post_type: unfollowedAccountReply.type,
                audience: unfollowedAccountReply.audience,
                post_id: unfollowedAccountReply.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: null,
            });
        }, 10000);
    });

    describe('handling a post being reposted', () => {
        it("should add to the reposter's feed and any follower feeds if the post audience is: Public or FollowersOnly", async () => {
            const feedService = new FeedService(client, events);

            // Initialise user internal account
            const userAccount = await createInternalAccount('foo.com');

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount('bar.com');

            await accountService.recordAccountFollow(
                // @TODO: Update this when AccountEntity is used everywhere
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will not follow
            const unfollowedAccount = await createInternalAccount('baz.com');

            // Create posts
            const unfollowedAccountPost = await createPost(unfollowedAccount, {
                audience: Audience.Public,
            });

            await postRepository.save(unfollowedAccountPost);
            await waitForPostAddedToFeeds(unfollowedAccountPost);

            unfollowedAccountPost.addRepost(followedAccount);
            await postRepository.save(unfollowedAccountPost);
            await waitForPostAddedToFeeds(unfollowedAccountPost);

            // Assert feeds for each account are as expected

            // userAccount should have 1 posts in their feed:
            // - The reposted post (because they follow followedAccount)
            const userAccountFeed = await getFeedForAccount(userAccount);

            expect(userAccountFeed.length).toBe(1);
            expect(userAccountFeed[0]).toMatchObject({
                post_type: unfollowedAccountPost.type,
                audience: unfollowedAccountPost.audience,
                post_id: unfollowedAccountPost.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: followedAccount.id,
            });

            // followedAccount should have 1 post in their feed:
            // - Their own (because they do not follow anyone)
            const followedAccountFeed =
                await getFeedForAccount(followedAccount);

            expect(followedAccountFeed.length).toBe(1);
            expect(followedAccountFeed[0]).toMatchObject({
                post_type: unfollowedAccountPost.type,
                audience: unfollowedAccountPost.audience,
                post_id: unfollowedAccountPost.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: followedAccount.id,
            });

            // unfollowedAccount should have 1 post in their feed:
            // - Their own (because they do not follow anyone)
            const unfollowedAccountFeed =
                await getFeedForAccount(unfollowedAccount);

            expect(unfollowedAccountFeed.length).toBe(1);
            expect(unfollowedAccountFeed[0]).toMatchObject({
                post_type: unfollowedAccountPost.type,
                audience: unfollowedAccountPost.audience,
                post_id: unfollowedAccountPost.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: null,
            });
        }, 10000);
    });
});
