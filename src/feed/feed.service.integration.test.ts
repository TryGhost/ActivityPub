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
import {
    Audience,
    type FollowersOnlyPost,
    type PostData,
    PostType,
    type PublicPost,
} from '../post/post.entity';
import { Post } from '../post/post.entity';
import { KnexPostRepository } from '../post/post.repository.knex';
import { SiteService } from '../site/site.service';
import { FeedService } from './feed.service';

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

    const getFeedDataForAccount = async (account: Account) => {
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

        // Init deps / support
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

    describe('addPostToFeeds', () => {
        it('should add a post to the feeds of the users that should see it', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
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
            const externalAccount = await createExternalAccount('qux.com');

            await accountService.recordAccountFollow(
                userAccount as unknown as AccountType, // @TODO: Update this when AccountEntity is used everywhere
                externalAccount,
            );

            // Initialise posts
            const userAccountPost = await createPost(userAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(userAccountPost);

            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.FollowersOnly,
            });
            await postRepository.save(followedAccountPost);

            const unfollowedAccountPost = await createPost(unfollowedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(unfollowedAccountPost);

            // Update feeds
            await feedService.addPostToFeeds(userAccountPost as PublicPost);
            await feedService.addPostToFeeds(
                followedAccountPost as FollowersOnlyPost,
            );
            await feedService.addPostToFeeds(
                unfollowedAccountPost as PublicPost,
            );

            // Assert feeds for each account are as expected

            // userAccount should have 2 posts in their feed:
            // - Their own
            // - followedAccount's post (because userAccount follows followedAccount)
            const userAccountFeed = await getFeedDataForAccount(userAccount);

            expect(userAccountFeed.length).toBe(2);
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

            // followedAccount should have 1 post in their feed:
            // - Their own (because they do not follow anyone)
            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeed.length).toBe(1);
            expect(followedAccountFeed[0]).toMatchObject({
                post_type: followedAccountPost.type,
                audience: followedAccountPost.audience,
                post_id: followedAccountPost.id,
                author_id: followedAccount.id,
                reposted_by_id: null,
            });

            // unfollowedAccount should have 1 post in their feed:
            // - Their own (because they do not follow anyone)
            const unfollowedAccountFeed =
                await getFeedDataForAccount(unfollowedAccount);
            expect(unfollowedAccountFeed.length).toBe(1);
            expect(unfollowedAccountFeed[0]).toMatchObject({
                post_type: unfollowedAccountPost.type,
                audience: unfollowedAccountPost.audience,
                post_id: unfollowedAccountPost.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: null,
            });
        }, 10000);

        it('should addd reposted posts to the feeds of the users that should see it', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
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

            // Initialise posts
            const unfollowedAccountPost = await createPost(unfollowedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(unfollowedAccountPost);

            unfollowedAccountPost.addRepost(followedAccount);
            await postRepository.save(unfollowedAccountPost);

            // Update feeds
            await feedService.addPostToFeeds(
                unfollowedAccountPost as PublicPost,
            );

            await feedService.addPostToFeeds(
                unfollowedAccountPost as PublicPost,
                followedAccount.id,
            );

            // Assert feeds for each account are as expected

            // userAccount should have 1 posts in their feed:
            // - The reposted post (because they follow followedAccount)
            const userAccountFeed = await getFeedDataForAccount(userAccount);

            expect(userAccountFeed.length).toBe(1);
            expect(userAccountFeed[0]).toMatchObject({
                post_type: unfollowedAccountPost.type,
                audience: unfollowedAccountPost.audience,
                post_id: unfollowedAccountPost.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: followedAccount.id,
            });

            // followedAccount should have 1 post in their feed:
            // - The post they reposted
            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);

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
                await getFeedDataForAccount(unfollowedAccount);

            expect(unfollowedAccountFeed.length).toBe(1);
            expect(unfollowedAccountFeed[0]).toMatchObject({
                post_type: unfollowedAccountPost.type,
                audience: unfollowedAccountPost.audience,
                post_id: unfollowedAccountPost.id,
                author_id: unfollowedAccount.id,
                reposted_by_id: null,
            });
        }, 10000);

        it('should not add replies to feeds', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('foo.com');

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount('bar.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise a post that the user will reply to
            const post = await createPost(userAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(post);

            // Initialise a reply to the post
            const reply = await createPost(followedAccount, {
                audience: Audience.Public,
                inReplyTo: post,
            });
            await postRepository.save(reply);

            // Update feeds
            await feedService.addPostToFeeds(post as PublicPost);
            await feedService.addPostToFeeds(reply as PublicPost);

            // Assert feeds for each account are as expected

            // userAccount should have 1 posts in their feed:
            // - followedAccount's post (because they follow followedAccount and
            //   replies are not added to feeds)
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(1);
            expect(userAccountFeed[0]).toMatchObject({
                post_type: post.type,
                audience: post.audience,
                post_id: post.id,
                author_id: post.author.id,
            });

            // followedAccount should have 0 posts in their feed:
            // - They replied to userAccount's post but we do not add replies to
            //   feeds
            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeed.length).toBe(0);
        }, 10000);
    });

    describe('removePostFromFeeds', () => {
        it('should remove a post from the feeds of the users that can already see it', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('foo.com');

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount('bar.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise another internal account that will follow the internal
            // account that is not the user
            const otherAccount = await createInternalAccount('baz.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                otherAccount as unknown as AccountType,
            );

            // Initialise posts
            const userAccountPost = await createPost(userAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(userAccountPost);

            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);

            // Add the posts to the feeds of the users that should see them
            await feedService.addPostToFeeds(userAccountPost as PublicPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            // Remove followedAccountPost from the feeds of the users that can
            // already see it
            await feedService.removePostFromFeeds(
                followedAccountPost as PublicPost,
            );

            // Assert feeds for each account are as expected

            // userAccount should have 1 post in their feed:
            // - Their own (because the post from followedAccount was removed)
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(1);

            // followedAccount should have 0 posts in their feed:
            // - The post they posted is no longer in their feed because it was
            //   removed
            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeed.length).toBe(0);

            // otherAccount should have 0 posts in their feed:
            // - The post from followedAccount was removed
            const otherAccountFeed = await getFeedDataForAccount(otherAccount);
            expect(otherAccountFeed.length).toBe(0);
        }, 10000);

        it('should remove dereposted post from feeds', async () => {
            const feedService = new FeedService(client);

            // Initialise accounts
            const userAccount = await createInternalAccount('foo.com');
            const followedAccount = await createInternalAccount('bar.com');
            const postAuthorAccount = await createInternalAccount('baz.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Create post and repost
            const post = await createPost(postAuthorAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(post);
            post.addRepost(followedAccount);
            await postRepository.save(post);

            // Add to feeds
            await feedService.addPostToFeeds(post as PublicPost);
            await feedService.addPostToFeeds(
                post as PublicPost,
                followedAccount.id,
            );

            // Verify repost is in feed initially
            const feedBeforeRemoval = await getFeedDataForAccount(userAccount);
            expect(feedBeforeRemoval.length).toBe(1);
            expect(feedBeforeRemoval[0]).toMatchObject({
                post_id: post.id,
                author_id: postAuthorAccount.id,
                reposted_by_id: followedAccount.id,
            });

            // Remove repost from feeds
            await feedService.removePostFromFeeds(
                post as PublicPost,
                followedAccount.id,
            );

            // Verify repost was removed
            const feedAfterRemoval = await getFeedDataForAccount(userAccount);
            expect(feedAfterRemoval.length).toBe(0);
        }, 10000);

        it('should not affect other reposts when removing a specific derepost', async () => {
            const feedService = new FeedService(client);

            // Initialise accounts
            const userAccount = await createInternalAccount('foo.com');
            const reposter1 = await createInternalAccount('bar.com');
            const reposter2 = await createInternalAccount('baz.com');
            const postAuthorAccount = await createInternalAccount('qux.com');

            await accountService.recordAccountFollow(
                reposter1 as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                reposter2 as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Create post and add two reposts
            const post = await createPost(postAuthorAccount, {
                audience: Audience.Public,
            });

            await postRepository.save(post);
            post.addRepost(reposter1);
            await postRepository.save(post);
            post.addRepost(reposter2);
            await postRepository.save(post);

            // Add to feeds
            await feedService.addPostToFeeds(post as PublicPost);
            await feedService.addPostToFeeds(post as PublicPost, reposter1.id);
            await feedService.addPostToFeeds(post as PublicPost, reposter2.id);

            expect(true).toBe(true);

            // Remove only reposter1's repost
            await feedService.removePostFromFeeds(
                post as PublicPost,
                reposter1.id,
            );

            // Verify only reposter2's repost remains
            const feedAfterRemoval = await getFeedDataForAccount(userAccount);

            expect(feedAfterRemoval.length).toBe(1);

            expect(feedAfterRemoval[0]).toMatchObject({
                post_id: post.id,
                author_id: postAuthorAccount.id,
                reposted_by_id: reposter2.id,
            });
        }, 10000);
    });
});
