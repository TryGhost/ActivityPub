import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import type { AccountEntity } from '../account/account.entity';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import type { Account as AccountType, Site } from '../account/types';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
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
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;
    let postRepository: KnexPostRepository;
    let client: Knex;

    beforeAll(async () => {
        client = await createTestDb();
    });

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
    const createPost = async (
        account: AccountEntity,
        data: Partial<PostData>,
    ) => {
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

    const getFeedDataForAccount = async (account: AccountEntity) => {
        const feed = await client('feeds')
            .join('users', 'users.id', 'feeds.user_id')
            .join('accounts', 'accounts.id', 'users.account_id')
            .where('accounts.id', account.id);

        return feed;
    };

    beforeEach(async () => {
        // Clean up the database
        await client.raw('SET FOREIGN_KEY_CHECKS = 0');
        await client('feeds').truncate();
        await client('reposts').truncate();
        await client('posts').truncate();
        await client('follows').truncate();
        await client('accounts').truncate();
        await client('users').truncate();
        await client('sites').truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Reset test state
        accountSitesMap.clear();
        externalAccountCount = 0;
        postCount = 0;

        // Init deps / support
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
                    },
                };
            },
        });
        postRepository = new KnexPostRepository(client, events);
    });

    describe('getFeedData', () => {
        it('should get the posts for a users feed, and make sure the content is sanitised', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('foo.com');

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount('bar.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);

            // Update feeds
            await feedService.addPostToFeeds(
                followedAccountPost as FollowersOnlyPost,
            );

            await client('posts')
                .update({
                    content: 'Hello world!<script>alert("hax")</script>',
                })
                .where({ id: followedAccountPost.id });

            const feed = await feedService.getFeedData({
                accountId: userAccount.id!,
                feedType: 'Inbox',
                limit: 10,
                cursor: null,
            });

            expect(feed.results).toMatchInlineSnapshot([
                {
                    post_content: 'Hello world!<script></script>',
                },
            ]);
        });

        it('should sort feed items by published_at', async () => {
            const feedService = new FeedService(client);

            const userAccount =
                await createInternalAccount('sort-test-user.com');
            const followedAccount = await createInternalAccount(
                'sort-test-followed.com',
            );

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Create posts with specific dates
            const post1 = await createPost(followedAccount, {
                audience: Audience.Public,
                publishedAt: new Date('2024-01-01T10:00:00Z'),
            });
            await postRepository.save(post1);

            const post2 = await createPost(followedAccount, {
                audience: Audience.Public,
                publishedAt: new Date('2024-01-02T10:00:00Z'),
            });
            await postRepository.save(post2);

            await feedService.addPostToFeeds(post1 as PublicPost);
            await feedService.addPostToFeeds(post2 as PublicPost);

            post1.addRepost(userAccount);
            await postRepository.save(post1);

            // Set repost date
            await client('reposts')
                .where({ post_id: post1.id, account_id: userAccount.id })
                .update({ created_at: new Date('2024-01-03T10:00:00Z') });

            await feedService.addPostToFeeds(
                post1 as PublicPost,
                userAccount.id,
            );

            // Get feed and verify order
            const feed = await feedService.getFeedData({
                accountId: userAccount.id!,
                feedType: 'Inbox',
                limit: 10,
                cursor: null,
            });

            // Should be ordered: repost of post1 (Jan 3), post2 (Jan 2), post1 (Jan 1)
            expect(feed.results).toHaveLength(3);
            expect(
                feed.results.map((post) => ({
                    post_id: post.post_id,
                    reposted_by_id: post.reposter_id,
                })),
            ).toEqual([
                {
                    post_id: post1.id,
                    reposted_by_id: userAccount.id,
                },
                {
                    post_id: post2.id,
                    reposted_by_id: null,
                },
                {
                    post_id: post1.id,
                    reposted_by_id: null,
                },
            ]);
        });
    });

    describe('addPostToFeeds', () => {
        it('should add a post to the feeds of the users that should see it', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount =
                await createInternalAccount('add-post-user.com');

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount(
                'add-post-followed.com',
            );

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will not follow
            const unfollowedAccount = await createInternalAccount(
                'add-post-unfollowed.com',
            );

            // Initialise an external account that follows the user - This account
            // should not have a feed so we should not try and add a post to it.
            const externalAccount = await createExternalAccount(
                'add-post-external.com',
            );

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

        it('should add reposted posts to the feeds of the users that should see it', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount(
                'add-reposted-user.com',
            );

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount(
                'add-reposted-followed.com',
            );

            await accountService.recordAccountFollow(
                // @TODO: Update this when AccountEntity is used everywhere
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will not follow
            const unfollowedAccount = await createInternalAccount(
                'add-reposted-unfollowed.com',
            );

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
            const userAccount = await createInternalAccount(
                'add-replies-user.com',
            );

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount(
                'add-replies-followed.com',
            );

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

        it('should use repost timestamp as published_at when post is a reposted', async () => {
            const feedService = new FeedService(client);
            const originalPublishDate = new Date('2024-01-01T00:00:00Z');
            const repostDate = new Date('2024-02-01T00:00:00Z');

            // Create test accounts
            const authorAccount = await createInternalAccount('author.com');
            const repostingAccount =
                await createInternalAccount('reposter.com');

            // Create test post
            const post = await createPost(authorAccount, {
                publishedAt: originalPublishDate,
                type: PostType.Note,
                audience: Audience.Public,
            });
            await postRepository.save(post);

            // Create repost record
            await client('reposts').insert({
                account_id: repostingAccount.id,
                post_id: post.id,
                created_at: repostDate,
            });

            // Add post to feeds through repost
            await feedService.addPostToFeeds(
                post as PublicPost,
                repostingAccount.id,
            );

            // Verify feed entry
            const feedEntry = await client('feeds')
                .where({
                    post_id: post.id,
                    reposted_by_id: repostingAccount.id,
                })
                .first();

            expect(feedEntry).toBeTruthy();
            expect(feedEntry.published_at).toEqual(repostDate);
        }, 10000);

        it('should use original published_at timestamp when post is not reposted', async () => {
            const feedService = new FeedService(client);
            const originalPublishDate = new Date('2024-01-01T00:00:00Z');

            // Create test account
            const authorAccount = await createInternalAccount('author.com');

            // Create test post
            const post = await createPost(authorAccount, {
                publishedAt: originalPublishDate,
                type: PostType.Note,
                audience: Audience.Public,
            });
            await postRepository.save(post);

            // Add post to feeds normally (not reposted)
            await feedService.addPostToFeeds(post as PublicPost);

            // Verify feed entry
            const feedEntry = await client('feeds')
                .where({
                    post_id: post.id,
                    reposted_by_id: null,
                })
                .first();

            expect(feedEntry).toBeTruthy();
            expect(feedEntry.published_at).toEqual(originalPublishDate);
        }, 10000);
    });

    describe('removePostFromFeeds', () => {
        it('should remove a post from the feeds of the users that can already see it', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount =
                await createInternalAccount('add-post-user.com');

            // Initialise an internal account that the user will follow
            const followedAccount = await createInternalAccount(
                'add-post-followed.com',
            );

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise another internal account that will follow the internal
            // account that is not the user
            const otherAccount =
                await createInternalAccount('add-post-other.com');

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
            const userAccount = await createInternalAccount(
                'remove-derepost-user.com',
            );
            const followedAccount = await createInternalAccount(
                'remove-derepost-followed.com',
            );
            const postAuthorAccount = await createInternalAccount(
                'remove-derepost-author.com',
            );

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
            const userAccount =
                await createInternalAccount('derepost-user.com');
            const reposter1 = await createInternalAccount(
                'derepost-reposter1.com',
            );
            const reposter2 = await createInternalAccount(
                'derepost-reposter2.com',
            );
            const postAuthorAccount = await createInternalAccount(
                'derepost-post-author.com',
            );

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

    describe('removeBlockedAccountPostsFromFeed', () => {
        it('should remove posts from feeds when an account is blocked', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('user.com');

            // Initialise an internal account that the user will follow and block
            const blockedAccount = await createInternalAccount('blocked.com');

            await accountService.recordAccountFollow(
                blockedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow and that
            // also follows the blocked account
            const followedAccount = await createInternalAccount('followed.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                blockedAccount as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Initialise posts
            const blockedAccountPost = await createPost(blockedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(blockedAccountPost);
            await feedService.addPostToFeeds(blockedAccountPost as PublicPost);

            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            // Verify the feeds have the correct posts
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(2);
            expect(userAccountFeed[0]).toMatchObject({
                post_id: blockedAccountPost.id,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeed.length).toBe(2);
            expect(followedAccountFeed[0]).toMatchObject({
                post_id: blockedAccountPost.id,
            });
            expect(followedAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            const blockedAccountFeed =
                await getFeedDataForAccount(blockedAccount);
            expect(blockedAccountFeed.length).toBe(1);
            expect(blockedAccountFeed[0]).toMatchObject({
                post_id: blockedAccountPost.id,
            });

            // Remove the blocked account's posts from the user's feed
            await feedService.removeBlockedAccountPostsFromFeed(
                userAccount,
                blockedAccount,
            );

            // Verify the post from the blocked account is removed from the
            // user's feed
            const userAccountFeedAfterRemoval =
                await getFeedDataForAccount(userAccount);
            expect(userAccountFeedAfterRemoval.length).toBe(1);
            expect(userAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            // Verify the post from the blocked account is not removed from the
            // followed account feed
            const followedAccountFeedAfterRemoval =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeedAfterRemoval.length).toBe(2);
            expect(followedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: blockedAccountPost.id,
            });
            expect(followedAccountFeedAfterRemoval[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            // Verify the blocked account's post is not removed from the
            // blocked account's feed
            const blockedAccountFeedAfterRemoval =
                await getFeedDataForAccount(blockedAccount);
            expect(blockedAccountFeedAfterRemoval.length).toBe(1);
            expect(blockedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: blockedAccountPost.id,
            });
        }, 10000);

        it('should remove reposts from feeds when an account is blocked', async () => {
            const feedService = new FeedService(client);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('user.com');

            // Initialise an internal account that the user will follow and block
            const blockedAccount = await createInternalAccount('blocked.com');

            await accountService.recordAccountFollow(
                blockedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow and that
            // also follows the blocked account
            const followedAccount = await createInternalAccount('followed.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                blockedAccount as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Initialise posts
            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            followedAccountPost.addRepost(blockedAccount);
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(
                followedAccountPost as PublicPost,
                blockedAccount.id,
            );

            // Verify the feeds have the correct posts
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(2);
            expect(userAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedAccount.id,
            });

            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);

            expect(followedAccountFeed.length).toBe(2);
            expect(followedAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: null,
            });
            expect(followedAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedAccount.id,
            });

            const blockedAccountFeed =
                await getFeedDataForAccount(blockedAccount);
            expect(blockedAccountFeed.length).toBe(1);
            expect(blockedAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedAccount.id,
            });

            // Remove the blocked account's reposts from the user's feed
            await feedService.removeBlockedAccountPostsFromFeed(
                userAccount,
                blockedAccount,
            );

            // Verify the repost from the blocked account is removed from the
            // user's feed
            const userAccountFeedAfterRemoval =
                await getFeedDataForAccount(userAccount);
            expect(userAccountFeedAfterRemoval.length).toBe(1);
            expect(userAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                author_id: followedAccount.id,
                reposted_by_id: null,
            });

            // Verify the blocked account's repost is not removed from the
            // followed account's feed
            const followedAccountFeedAfterRemoval =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeedAfterRemoval.length).toBe(2);
            expect(followedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: null,
            });
            expect(followedAccountFeedAfterRemoval[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedAccount.id,
            });

            // Verify the blocked account's repost is not removed from the
            // blocked account's feed
            const blockedAccountFeedAfterRemoval =
                await getFeedDataForAccount(blockedAccount);
            expect(blockedAccountFeedAfterRemoval.length).toBe(1);
            expect(blockedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedAccount.id,
            });
        }, 10000);
    });
});
