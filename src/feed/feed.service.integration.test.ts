import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import type { Account as AccountType, Site } from '@/account/types';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { AsyncEvents } from '@/core/events';
import { FeedService } from '@/feed/feed.service';
import { ModerationService } from '@/moderation/moderation.service';
import {
    Audience,
    type FollowersOnlyPost,
    Post,
    type PostData,
    PostType,
    type PublicPost,
} from '@/post/post.entity';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { SiteService } from '@/site/site.service';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';
import { createTestDb } from '@/test/db';
import { TOP_PUBLISHERS } from './top-publishers';

describe('FeedService', () => {
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;
    let postRepository: KnexPostRepository;
    let moderationService: ModerationService;
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
        await client('outboxes').truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Reset test state
        accountSitesMap.clear();
        externalAccountCount = 0;
        postCount = 0;

        // Init deps / support
        const logger = {
            info: vi.fn(),
        } as unknown as Logger;
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
                    },
                };
            },
        });
        postRepository = new KnexPostRepository(client, events, logger);
        moderationService = new ModerationService(client);
    });

    describe('getFeedData', () => {
        it('should get the posts for a users feed, and make sure the content is sanitised', async () => {
            const feedService = new FeedService(client, moderationService);

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
            const feedService = new FeedService(client, moderationService);

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

        it('should correctly set followedByMe flag for authors', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create test accounts
            const userAccount = await createInternalAccount(
                'follower-test-user.com',
            );
            const followedAccount = await createInternalAccount(
                'follower-test-followed.com',
            );
            const unfollowedAccount = await createInternalAccount(
                'follower-test-unfollowed.com',
            );

            // User follows followedAccount but NOT unfollowedAccount
            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Create a post from followedAccount
            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
                publishedAt: new Date('2024-01-01T10:00:00Z'),
            });
            await postRepository.save(followedAccountPost);

            // Create a post from unfollowedAccount
            const unfollowedAccountPost = await createPost(unfollowedAccount, {
                audience: Audience.Public,
                publishedAt: new Date('2024-01-02T10:00:00Z'),
            });
            await postRepository.save(unfollowedAccountPost);

            // followedAccount reposts the unfollowedAccount's post
            unfollowedAccountPost.addRepost(followedAccount);
            await postRepository.save(unfollowedAccountPost);

            // Add posts to feeds
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);
            await feedService.addPostToFeeds(
                unfollowedAccountPost as PublicPost,
            );
            await feedService.addPostToFeeds(
                unfollowedAccountPost as PublicPost,
                followedAccount.id,
            );

            // Get feed and verify followedByMe flags
            const feed = await feedService.getFeedData({
                accountId: userAccount.id!,
                feedType: 'Inbox',
                limit: 10,
                cursor: null,
            });

            // Should have 2 items: the repost and the original post from followedAccount
            expect(feed.results).toHaveLength(2);

            // Find the reposted post (unfollowedAccount's post reposted by followedAccount)
            const repostedPost = feed.results.find(
                (post) =>
                    post.post_id === unfollowedAccountPost.id &&
                    post.reposter_id === followedAccount.id,
            );
            expect(repostedPost).toBeDefined();
            expect(repostedPost!.author_id).toBe(unfollowedAccount.id);
            expect(repostedPost!.author_followed_by_user).toBe(0); // User does NOT follow unfollowedAccount

            // Find the original post from followedAccount
            const originalPost = feed.results.find(
                (post) =>
                    post.post_id === followedAccountPost.id &&
                    post.reposter_id === null,
            );
            expect(originalPost).toBeDefined();
            expect(originalPost!.author_id).toBe(followedAccount.id);
            expect(originalPost!.author_followed_by_user).toBe(1); // User DOES follow followedAccount
        });

        it('should correctly set followedByMe flag for reposters', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create test accounts
            const userAccount = await createInternalAccount(
                'reposter-test-user.com',
            );
            const followedReposter = await createInternalAccount(
                'reposter-test-followed.com',
            );
            const unfollowedReposter = await createInternalAccount(
                'reposter-test-unfollowed.com',
            );
            const postAuthor = await createInternalAccount(
                'reposter-test-author.com',
            );

            // User follows followedReposter and postAuthor but NOT unfollowedReposter
            await accountService.recordAccountFollow(
                followedReposter as unknown as AccountType,
                userAccount as unknown as AccountType,
            );
            await accountService.recordAccountFollow(
                postAuthor as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Create a post from postAuthor
            const originalPost = await createPost(postAuthor, {
                audience: Audience.Public,
                publishedAt: new Date('2024-01-01T10:00:00Z'),
            });
            await postRepository.save(originalPost);

            // Both followedReposter and unfollowedReposter repost the original post
            originalPost.addRepost(followedReposter);
            await postRepository.save(originalPost);

            originalPost.addRepost(unfollowedReposter);
            await postRepository.save(originalPost);

            // Add posts to feeds
            await feedService.addPostToFeeds(originalPost as PublicPost);
            await feedService.addPostToFeeds(
                originalPost as PublicPost,
                followedReposter.id,
            );
            await feedService.addPostToFeeds(
                originalPost as PublicPost,
                unfollowedReposter.id,
            );

            // Get feed and verify followedByMe flags for reposters
            const feed = await feedService.getFeedData({
                accountId: userAccount.id!,
                feedType: 'Inbox',
                limit: 10,
                cursor: null,
            });

            // Should have 2 items: the repost from followedReposter and the original post
            // (repost from unfollowedReposter should not appear in feed)
            expect(feed.results).toHaveLength(2);

            // Find the repost from followedReposter
            const repostByFollowed = feed.results.find(
                (post) =>
                    post.post_id === originalPost.id &&
                    post.reposter_id === followedReposter.id,
            );
            expect(repostByFollowed).toBeDefined();
            expect(repostByFollowed!.author_id).toBe(postAuthor.id);
            expect(repostByFollowed!.author_followed_by_user).toBe(1); // User follows the original author
            expect(repostByFollowed!.reposter_id).toBe(followedReposter.id);
            expect(repostByFollowed!.reposter_followed_by_user).toBe(1); // User follows the reposter

            // Find the original post
            const originalPostInFeed = feed.results.find(
                (post) =>
                    post.post_id === originalPost.id &&
                    post.reposter_id === null,
            );
            expect(originalPostInFeed).toBeDefined();
            expect(originalPostInFeed!.author_id).toBe(postAuthor.id);
            expect(originalPostInFeed!.author_followed_by_user).toBe(1); // User follows the author
            expect(originalPostInFeed!.reposter_id).toBeNull();
            expect(originalPostInFeed!.reposter_followed_by_user).toBe(0); // No reposter, so 0
        });

        it('should correctly set followedByMe flag for unfollowed reposters', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create test accounts
            const userAccount = await createInternalAccount(
                'unfollowed-reposter-user.com',
            );
            const unfollowedReposter = await createInternalAccount(
                'unfollowed-reposter.com',
            );
            const followedAccount = await createInternalAccount(
                'unfollowed-reposter-followed.com',
            );
            const postAuthor = await createInternalAccount(
                'unfollowed-reposter-author.com',
            );

            // User follows followedAccount who follows unfollowedReposter
            // User does NOT follow unfollowedReposter or postAuthor
            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );
            await accountService.recordAccountFollow(
                unfollowedReposter as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Create a post from postAuthor
            const originalPost = await createPost(postAuthor, {
                audience: Audience.Public,
                publishedAt: new Date('2024-01-01T10:00:00Z'),
            });
            await postRepository.save(originalPost);

            // unfollowedReposter reposts the original post
            originalPost.addRepost(unfollowedReposter);
            await postRepository.save(originalPost);

            // followedAccount also reposts it
            originalPost.addRepost(followedAccount);
            await postRepository.save(originalPost);

            // Add posts to feeds
            await feedService.addPostToFeeds(originalPost as PublicPost);
            await feedService.addPostToFeeds(
                originalPost as PublicPost,
                unfollowedReposter.id,
            );
            await feedService.addPostToFeeds(
                originalPost as PublicPost,
                followedAccount.id,
            );

            // Get feed and verify followedByMe flags
            const feed = await feedService.getFeedData({
                accountId: userAccount.id!,
                feedType: 'Inbox',
                limit: 10,
                cursor: null,
            });

            // Should only have the repost from followedAccount
            // (unfollowedReposter's repost should not appear in feed)
            expect(feed.results).toHaveLength(1);

            // Find the repost from followedAccount
            const repostByFollowed = feed.results.find(
                (post) =>
                    post.post_id === originalPost.id &&
                    post.reposter_id === followedAccount.id,
            );
            expect(repostByFollowed).toBeDefined();
            expect(repostByFollowed!.author_id).toBe(postAuthor.id);
            expect(repostByFollowed!.author_followed_by_user).toBe(0); // User does NOT follow the original author
            expect(repostByFollowed!.reposter_id).toBe(followedAccount.id);
            expect(repostByFollowed!.reposter_followed_by_user).toBe(1); // User DOES follow the reposter
        });
    });

    describe('getGlobalFeedUserId', () => {
        it('should return the global feed user ID when it exists', async () => {
            const feedService = new FeedService(client, moderationService);

            const globalAccount = await createInternalAccount(
                'ap-global-feed.ghost.io',
            );

            const expectedUser = await client('users')
                .where('account_id', globalAccount.id)
                .select('id')
                .first();

            const userId = await feedService.getGlobalFeedUserId();

            expect(userId).toBe(expectedUser.id);
        });

        it('should return null when the global feed user does not exist', async () => {
            const feedService = new FeedService(client, moderationService);

            const userId = await feedService.getGlobalFeedUserId();

            expect(userId).toBe(null);
        });

        it('should cache the result after first lookup', async () => {
            const feedService = new FeedService(client, moderationService);

            const globalAccount = await createInternalAccount(
                'ap-global-feed.ghost.io',
            );

            // First call - loads from database
            const userId1 = await feedService.getGlobalFeedUserId();
            expect(userId1).not.toBe(null);

            // Delete the account from the database
            await client('users')
                .where('account_id', globalAccount.id)
                .delete();

            await client('accounts').where('id', globalAccount.id).delete();

            // Second call - should return cached value, not null
            const userId2 = await feedService.getGlobalFeedUserId();

            expect(userId2).toBe(userId1); // Still returns the cached ID
            expect(userId2).not.toBe(null); // Not null even though record is gone
        });
    });

    describe('addPostToFeeds', () => {
        it('should add a post to the feeds of the users that should see it', async () => {
            const feedService = new FeedService(client, moderationService);

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
        });

        it('should add reposted posts to the feeds of the users that should see it', async () => {
            const feedService = new FeedService(client, moderationService);

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
        });

        it('should not add replies to feeds', async () => {
            const feedService = new FeedService(client, moderationService);

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
        });

        it('should use repost timestamp as published_at when post is a reposted', async () => {
            const feedService = new FeedService(client, moderationService);
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
        });

        it('should use original published_at timestamp when post is not reposted', async () => {
            const feedService = new FeedService(client, moderationService);
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
        });

        it('should add Article posts from top publishers to the global feed', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create the global feed account
            const globalAccount = await createInternalAccount(
                'ap-global-feed.ghost.io',
            );

            // Create a top publisher
            const topPublisherAccount =
                await createInternalAccount('author.com');

            // Add it to the list of top publishers
            TOP_PUBLISHERS.add(topPublisherAccount.id);

            // Create Article post
            const articlePost = await createPost(topPublisherAccount, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(articlePost);

            // Add the post to feeds
            await feedService.addPostToFeeds(articlePost as PublicPost);

            // Verify the post was added to the global feed
            const globalFeed = await getFeedDataForAccount(globalAccount);
            expect(globalFeed).toHaveLength(1);
            expect(globalFeed[0]).toMatchObject({
                post_id: articlePost.id,
                author_id: topPublisherAccount.id,
            });
        });

        it('should NOT add Article posts from other publishers to the global feed', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create the global feed account
            const globalAccount = await createInternalAccount(
                'ap-global-feed.ghost.io',
            );

            // Create author
            const authorAccount = await createInternalAccount('author.com');

            // Create Article post
            const articlePost = await createPost(authorAccount, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(articlePost);

            // Add the post to feeds
            await feedService.addPostToFeeds(articlePost as PublicPost);

            // Verify the post was NOT added to the global feed
            const globalFeed = await getFeedDataForAccount(globalAccount);
            expect(globalFeed).toHaveLength(1);
            expect(globalFeed[0]).toMatchObject({
                post_id: articlePost.id,
                author_id: authorAccount.id,
            });
        });

        it('should NOT add Note posts to the global feed', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create the global feed account
            const globalAccount = await createInternalAccount(
                'ap-global-feed.ghost.io',
            );

            // Create an author and a Note post
            const authorAccount = await createInternalAccount('author.com');
            const notePost = await createPost(authorAccount, {
                type: PostType.Note,
                audience: Audience.Public,
            });
            await postRepository.save(notePost);

            // Add the post to feeds
            await feedService.addPostToFeeds(notePost as PublicPost);

            // Verify the post was NOT added to the global feed
            const globalFeed = await getFeedDataForAccount(globalAccount);
            expect(globalFeed).toHaveLength(0);
        });
    });

    describe('removePostFromFeeds', () => {
        it('should remove a post from the feeds of the users that can already see it', async () => {
            const feedService = new FeedService(client, moderationService);

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
        });

        it('should remove dereposted post from feeds', async () => {
            const feedService = new FeedService(client, moderationService);

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
        });

        it('should not affect other reposts when removing a specific derepost', async () => {
            const feedService = new FeedService(client, moderationService);

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
        });
    });

    describe('removeBlockedAccountPostsFromFeed', () => {
        it('should remove posts from feeds when an account is blocked', async () => {
            const feedService = new FeedService(client, moderationService);

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
                userAccount.id,
                blockedAccount.id,
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
        });

        it('should remove reposts from feeds when an account is blocked', async () => {
            const feedService = new FeedService(client, moderationService);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('user.com');

            // Initialise an internal account that the user will follow and block
            // the domain of
            const blockedDomainAccount =
                await createInternalAccount('blocked.com');

            await accountService.recordAccountFollow(
                blockedDomainAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow and that
            // also follows the blocked domain account
            const followedAccount = await createInternalAccount('followed.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                blockedDomainAccount as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Initialise posts
            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            followedAccountPost.addRepost(blockedDomainAccount);
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(
                followedAccountPost as PublicPost,
                blockedDomainAccount.id,
            );

            // Verify the feeds have the correct posts
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(2);
            expect(userAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedDomainAccount.id,
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
                reposted_by_id: blockedDomainAccount.id,
            });

            const blockedDomainAccountFeed =
                await getFeedDataForAccount(blockedDomainAccount);
            expect(blockedDomainAccountFeed.length).toBe(1);
            expect(blockedDomainAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedDomainAccount.id,
            });

            // Remove the blocked account's reposts from the user's feed
            await feedService.removeBlockedAccountPostsFromFeed(
                userAccount.id,
                blockedDomainAccount.id,
            );

            // Verify the repost from the blocked domain account is removed from
            // the user's feed
            const userAccountFeedAfterRemoval =
                await getFeedDataForAccount(userAccount);
            expect(userAccountFeedAfterRemoval.length).toBe(1);
            expect(userAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                author_id: followedAccount.id,
                reposted_by_id: null,
            });

            // Verify the blocked domain account's repost is not removed from
            // the followed account's feed
            const followedAccountFeedAfterRemoval =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeedAfterRemoval.length).toBe(2);
            expect(followedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: null,
            });
            expect(followedAccountFeedAfterRemoval[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedDomainAccount.id,
            });

            // Verify the blocked domain account's repost is not removed from
            // the blocked domain account's feed
            const blockedDomainAccountFeedAfterRemoval =
                await getFeedDataForAccount(blockedDomainAccount);
            expect(blockedDomainAccountFeedAfterRemoval.length).toBe(1);
            expect(blockedDomainAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedDomainAccount.id,
            });
        });
    });

    describe('removeBlockedDomainPostsFromFeed', () => {
        it('should remove posts from feeds when a domain is blocked', async () => {
            const feedService = new FeedService(client, moderationService);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('user.com');

            // Initialise an internal account that the user will follow and block
            // the domain of
            const blockedDomainAccount =
                await createInternalAccount('blocked.com');

            await accountService.recordAccountFollow(
                blockedDomainAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow and that
            // also follows the blocked domain account
            const followedAccount = await createInternalAccount('followed.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                blockedDomainAccount as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Initialise posts
            const blockedDomainAccountPost = await createPost(
                blockedDomainAccount,
                {
                    audience: Audience.Public,
                },
            );
            await postRepository.save(blockedDomainAccountPost);
            await feedService.addPostToFeeds(
                blockedDomainAccountPost as PublicPost,
            );

            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            // Verify the feeds have the correct posts
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(2);
            expect(userAccountFeed[0]).toMatchObject({
                post_id: blockedDomainAccountPost.id,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeed.length).toBe(2);
            expect(followedAccountFeed[0]).toMatchObject({
                post_id: blockedDomainAccountPost.id,
            });
            expect(followedAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            const blockedDomainAccountFeed =
                await getFeedDataForAccount(blockedDomainAccount);
            expect(blockedDomainAccountFeed.length).toBe(1);
            expect(blockedDomainAccountFeed[0]).toMatchObject({
                post_id: blockedDomainAccountPost.id,
            });

            // Remove the blocked domain account's posts from the user's feed
            await feedService.removeBlockedDomainPostsFromFeed(
                userAccount.id,
                blockedDomainAccount.apId,
            );

            // Verify the post from the blocked domain account is removed from
            // the user's feed
            const userAccountFeedAfterRemoval =
                await getFeedDataForAccount(userAccount);
            expect(userAccountFeedAfterRemoval.length).toBe(1);
            expect(userAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            // Verify the post from the blocked domain account is not removed
            // from the followed account feed
            const followedAccountFeedAfterRemoval =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeedAfterRemoval.length).toBe(2);
            expect(followedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: blockedDomainAccountPost.id,
            });
            expect(followedAccountFeedAfterRemoval[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            // Verify the blocked domain account's post is not removed from the
            // blocked domain account's feed
            const blockedDomainAccountFeedAfterRemoval =
                await getFeedDataForAccount(blockedDomainAccount);
            expect(blockedDomainAccountFeedAfterRemoval.length).toBe(1);
            expect(blockedDomainAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: blockedDomainAccountPost.id,
            });
        });

        it('should remove reposts from feeds when a domain is blocked', async () => {
            const feedService = new FeedService(client, moderationService);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('user.com');

            // Initialise an internal account that the user will follow and block
            // the domain of
            const blockedDomainAccount =
                await createInternalAccount('blocked.com');

            await accountService.recordAccountFollow(
                blockedDomainAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow and that
            // also follows the blocked domain account
            const followedAccount = await createInternalAccount('followed.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                blockedDomainAccount as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Initialise posts
            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            followedAccountPost.addRepost(blockedDomainAccount);
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(
                followedAccountPost as PublicPost,
                blockedDomainAccount.id,
            );

            // Verify the feeds have the correct posts
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(2);
            expect(userAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedDomainAccount.id,
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
                reposted_by_id: blockedDomainAccount.id,
            });

            const blockedDomainAccountFeed =
                await getFeedDataForAccount(blockedDomainAccount);
            expect(blockedDomainAccountFeed.length).toBe(1);
            expect(blockedDomainAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedDomainAccount.id,
            });

            // Remove the blocked account's reposts from the user's feed
            await feedService.removeBlockedDomainPostsFromFeed(
                userAccount.id,
                blockedDomainAccount.apId,
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
                reposted_by_id: blockedDomainAccount.id,
            });

            // Verify the blocked domain account's repost is not removed from
            // the blocked domain account's feed
            const blockedDomainAccountFeedAfterRemoval =
                await getFeedDataForAccount(blockedDomainAccount);
            expect(blockedDomainAccountFeedAfterRemoval.length).toBe(1);
            expect(blockedDomainAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: blockedDomainAccount.id,
            });
        });
    });

    describe('removeUnfollowedAccountPostsFromFeed', () => {
        it('should remove posts from feeds when an account is unfollowed', async () => {
            const feedService = new FeedService(client, moderationService);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('user.com');

            // Initialise an internal account that the user will follow and block
            const unfollowedAccount =
                await createInternalAccount('unfollowed.com');

            await accountService.recordAccountFollow(
                unfollowedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow and that
            // also follows the unfollowed account
            const followedAccount = await createInternalAccount('followed.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                unfollowedAccount as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Initialise posts
            const unfollowedAccountPost = await createPost(unfollowedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(unfollowedAccountPost);
            await feedService.addPostToFeeds(
                unfollowedAccountPost as PublicPost,
            );

            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            // Verify the feeds have the correct posts
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(2);
            expect(userAccountFeed[0]).toMatchObject({
                post_id: unfollowedAccountPost.id,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            const followedAccountFeed =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeed.length).toBe(2);
            expect(followedAccountFeed[0]).toMatchObject({
                post_id: unfollowedAccountPost.id,
            });
            expect(followedAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            const unfollowedAccountFeed =
                await getFeedDataForAccount(unfollowedAccount);
            expect(unfollowedAccountFeed.length).toBe(1);
            expect(unfollowedAccountFeed[0]).toMatchObject({
                post_id: unfollowedAccountPost.id,
            });

            // Unfollow the unfollowed account
            await client('follows')
                .where({
                    following_id: unfollowedAccount.id,
                    follower_id: userAccount.id,
                })
                .del();

            // Remove the unfollowed account's posts from the user's feed
            await feedService.removeUnfollowedAccountPostsFromFeed(
                userAccount.id,
                unfollowedAccount.id,
            );

            // Verify the post from the unfollowed account is removed from the
            // user's feed
            const userAccountFeedAfterRemoval =
                await getFeedDataForAccount(userAccount);
            expect(userAccountFeedAfterRemoval.length).toBe(1);
            expect(userAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            // Verify the post from the unfollowed account is not removed from the
            // followed account feed
            const followedAccountFeedAfterRemoval =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeedAfterRemoval.length).toBe(2);
            expect(followedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: unfollowedAccountPost.id,
            });
            expect(followedAccountFeedAfterRemoval[1]).toMatchObject({
                post_id: followedAccountPost.id,
            });

            // Verify the unfollowed account's post is not removed from the
            // unfollowed account's feed
            const unfollowedAccountFeedAfterRemoval =
                await getFeedDataForAccount(unfollowedAccount);
            expect(unfollowedAccountFeedAfterRemoval.length).toBe(1);
            expect(unfollowedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: unfollowedAccountPost.id,
            });
        });

        it('should remove reposts from feeds when an account is unfollowed', async () => {
            const feedService = new FeedService(client, moderationService);

            // Initialise an internal account for user
            const userAccount = await createInternalAccount('user.com');

            // Initialise an internal account that the user will follow and unfollow
            const unfollowedAccount =
                await createInternalAccount('unfollowed.com');

            await accountService.recordAccountFollow(
                unfollowedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            // Initialise an internal account that the user will follow and that
            // also follows the unfollowed account
            const followedAccount = await createInternalAccount('followed.com');

            await accountService.recordAccountFollow(
                followedAccount as unknown as AccountType,
                userAccount as unknown as AccountType,
            );

            await accountService.recordAccountFollow(
                unfollowedAccount as unknown as AccountType,
                followedAccount as unknown as AccountType,
            );

            // Initialise posts
            const followedAccountPost = await createPost(followedAccount, {
                audience: Audience.Public,
            });
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(followedAccountPost as PublicPost);

            followedAccountPost.addRepost(unfollowedAccount);
            await postRepository.save(followedAccountPost);
            await feedService.addPostToFeeds(
                followedAccountPost as PublicPost,
                unfollowedAccount.id,
            );

            // Verify the feeds have the correct posts
            const userAccountFeed = await getFeedDataForAccount(userAccount);
            expect(userAccountFeed.length).toBe(2);
            expect(userAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
            });
            expect(userAccountFeed[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: unfollowedAccount.id,
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
                reposted_by_id: unfollowedAccount.id,
            });

            const unfollowedAccountFeed =
                await getFeedDataForAccount(unfollowedAccount);
            expect(unfollowedAccountFeed.length).toBe(1);
            expect(unfollowedAccountFeed[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: unfollowedAccount.id,
            });

            // Unfollow the unfollowed account
            await client('follows')
                .where({
                    following_id: unfollowedAccount.id,
                    follower_id: userAccount.id,
                })
                .del();

            // Remove the blocked account's reposts from the user's feed
            await feedService.removeUnfollowedAccountPostsFromFeed(
                userAccount.id,
                unfollowedAccount.id,
            );

            // Verify the repost from the unfollowed account is removed from
            // the user's feed
            const userAccountFeedAfterRemoval =
                await getFeedDataForAccount(userAccount);
            expect(userAccountFeedAfterRemoval.length).toBe(1);
            expect(userAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                author_id: followedAccount.id,
                reposted_by_id: null,
            });

            // Verify the unfollowed account's repost is not removed from
            // the followed account's feed
            const followedAccountFeedAfterRemoval =
                await getFeedDataForAccount(followedAccount);
            expect(followedAccountFeedAfterRemoval.length).toBe(2);
            expect(followedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: null,
            });
            expect(followedAccountFeedAfterRemoval[1]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: unfollowedAccount.id,
            });

            // Verify the unfollowed account's repost is not removed from
            // the unfollowed account's feed
            const unfollowedAccountFeedAfterRemoval =
                await getFeedDataForAccount(unfollowedAccount);
            expect(unfollowedAccountFeedAfterRemoval.length).toBe(1);
            expect(unfollowedAccountFeedAfterRemoval[0]).toMatchObject({
                post_id: followedAccountPost.id,
                reposted_by_id: unfollowedAccount.id,
            });
        });
    });
});
