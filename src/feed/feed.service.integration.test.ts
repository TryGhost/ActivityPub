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
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('FeedService', () => {
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;
    let postRepository: KnexPostRepository;
    let moderationService: ModerationService;
    let fixtureManager: FixtureManager;
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

        const createdAccount = await accountService.createExternalAccount({
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

        // Fetch the account entity from the repository
        // `accountService.createExternalAccount()` returns a plain DTO,
        // but we need the full `Account` entity with methods for use with
        // `Post.createFromData()`
        const account = await accountRepository.getByApId(
            new URL(createdAccount.ap_id),
        );

        if (!account) {
            throw new Error(
                `Account not found with ap_id ${createdAccount.ap_id}`,
            );
        }

        return account;
    };

    let postCount = 0;
    const createPost = async (account: Account, data: Partial<PostData>) => {
        postCount++;

        const site = accountSitesMap.get(Number(account.id)) ?? {
            host: 'unknown',
        };

        const postData: PostData = {
            type: PostType.Article,
            audience: Audience.Public,
            title: `Post ${postCount}`,
            excerpt: `Post ${postCount} excerpt`,
            content: `Post ${postCount} content`,
            url: new URL(`https://${site.host}/post-${postCount}`),
            imageUrl: null,
            publishedAt: new Date('2025-01-01'),
            ...data,
        };

        if (!account.isInternal && !postData.apId) {
            postData.apId = new URL(`${account.apId}/posts/${postCount}`);
        }

        return Post.createFromData(account, postData);
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
        await client('discovery_feeds').truncate();
        await client('account_topics').truncate();
        await client('topics').truncate();
        await client('reposts').truncate();
        await client('posts').truncate();
        await client('follows').truncate();
        await client('blocks').truncate();
        await client('domain_blocks').truncate();
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
            debug: vi.fn(),
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
                        site_uuid: crypto.randomUUID(),
                    },
                };
            },
        });
        postRepository = new KnexPostRepository(client, events, logger);
        moderationService = new ModerationService(client);
        fixtureManager = createFixtureManager(client);
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

    describe('getDiscoveryFeedData', () => {
        it('should render articles for discovery feeds, sorted by most recently published', async () => {
            const feedService = new FeedService(client, moderationService);

            const viewerAccount = await createInternalAccount(
                'discovery-viewer.com',
            );

            const [technology] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            const [business] = await client('topics').insert({
                name: 'Business',
                slug: 'business',
            });

            // Create 2 authors and 2 posts on the Technology topic
            const technologyPublisher1 =
                await createInternalAccount('author1.com');
            const technologyPublisher2 =
                await createInternalAccount('author2.com');

            await client('account_topics').insert({
                account_id: technologyPublisher1.id,
                topic_id: technology,
            });
            await client('account_topics').insert({
                account_id: technologyPublisher2.id,
                topic_id: technology,
            });

            const technologyPost1 = await createPost(technologyPublisher1, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-01T10:00:00Z'),
            });
            await postRepository.save(technologyPost1);

            const technologyPost2 = await createPost(technologyPublisher2, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-03T10:00:00Z'),
            });
            await postRepository.save(technologyPost2);

            // Create 2 authors and 2 posts on the Business topic
            const businessPublisher1 =
                await createInternalAccount('author3.com');
            const businessPublisher2 =
                await createInternalAccount('author4.com');

            await client('account_topics').insert({
                account_id: businessPublisher1.id,
                topic_id: business,
            });
            await client('account_topics').insert({
                account_id: businessPublisher2.id,
                topic_id: business,
            });
            const businessPost1 = await createPost(businessPublisher1, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-02T10:00:00Z'),
            });
            await postRepository.save(businessPost1);

            const businessPost2 = await createPost(businessPublisher2, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-04T10:00:00Z'),
            });
            await postRepository.save(businessPost2);

            // Add posts to discovery feeds
            await feedService.addPostToDiscoveryFeeds(
                technologyPost1 as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                technologyPost2 as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                businessPost1 as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                businessPost2 as PublicPost,
            );

            // Get discovery feed for Technology
            const technologyFeed = await feedService.getDiscoveryFeedData(
                technology,
                viewerAccount.id,
                10,
                null,
            );

            // Should be sorted by most recent first
            expect(technologyFeed.results).toHaveLength(2);
            expect(technologyFeed.results[0].post_id).toBe(technologyPost2.id); // Jan 3
            expect(technologyFeed.results[1].post_id).toBe(technologyPost1.id); // Jan 1

            // Get discovery feed for Business
            const businessFeed = await feedService.getDiscoveryFeedData(
                business,
                viewerAccount.id,
                10,
                null,
            );

            // Should be sorted by most recent first
            expect(businessFeed.results).toHaveLength(2);
            expect(businessFeed.results[0].post_id).toBe(businessPost2.id); // Jan 4
            expect(businessFeed.results[1].post_id).toBe(businessPost1.id); // Jan 2
        });

        it('should sanitize posts before rendering in discovery feeds', async () => {
            const feedService = new FeedService(client, moderationService);

            const viewerAccount = await createInternalAccount(
                'sanitize-viewer.com',
            );

            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            const author = await createInternalAccount('author.com');
            await client('account_topics').insert({
                account_id: author.id,
                topic_id: topicId,
            });

            const post = await createPost(author, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(post);

            // Update post content with XSS attempt
            await client('posts')
                .update({
                    content: 'Hello world!<script>alert("xss")</script>',
                })
                .where({ id: post.id });

            await feedService.addPostToDiscoveryFeeds(post as PublicPost);

            const feed = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                10,
                null,
            );

            // Content should be sanitized
            expect(feed.results).toHaveLength(1);
            expect(feed.results[0].post_content).toBe(
                'Hello world!<script></script>',
            );
        });

        it('should correctly set post_liked_by_user flag', async () => {
            const feedService = new FeedService(client, moderationService);

            const viewerAccount =
                await createInternalAccount('likes-viewer.com');

            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            const author1 = await createInternalAccount('likes-author1.com');
            const author2 = await createInternalAccount('likes-author2.com');

            await client('account_topics').insert([
                { account_id: author1.id, topic_id: topicId },
                { account_id: author2.id, topic_id: topicId },
            ]);

            const likedPost = await createPost(author1, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(likedPost);

            const unlikedPost = await createPost(author2, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(unlikedPost);

            // Viewer likes the first post
            await client('likes').insert({
                account_id: viewerAccount.id,
                post_id: likedPost.id,
            });

            await feedService.addPostToDiscoveryFeeds(likedPost as PublicPost);
            await feedService.addPostToDiscoveryFeeds(
                unlikedPost as PublicPost,
            );

            const feed = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                10,
                null,
            );

            expect(feed.results).toHaveLength(2);

            // Find liked post
            const likedResult = feed.results.find(
                (r) => r.post_id === likedPost.id,
            );
            expect(likedResult).toBeDefined();
            expect(likedResult!.post_liked_by_user).toBe(1);

            // Find unliked post
            const unlikedResult = feed.results.find(
                (r) => r.post_id === unlikedPost.id,
            );
            expect(unlikedResult).toBeDefined();
            expect(unlikedResult!.post_liked_by_user).toBe(0);
        });

        it('should correctly set post_reposted_by_user flag', async () => {
            const feedService = new FeedService(client, moderationService);

            const viewerAccount =
                await createInternalAccount('reposts-viewer.com');

            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            const author1 = await createInternalAccount('reposts-author1.com');
            const author2 = await createInternalAccount('reposts-author2.com');

            await client('account_topics').insert([
                { account_id: author1.id, topic_id: topicId },
                { account_id: author2.id, topic_id: topicId },
            ]);

            const repostedPost = await createPost(author1, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(repostedPost);

            const notRepostedPost = await createPost(author2, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(notRepostedPost);

            // Viewer reposts the first post
            await client('reposts').insert({
                account_id: viewerAccount.id,
                post_id: repostedPost.id,
            });

            await feedService.addPostToDiscoveryFeeds(
                repostedPost as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                notRepostedPost as PublicPost,
            );

            const feed = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                10,
                null,
            );

            expect(feed.results).toHaveLength(2);

            // Find reposted post
            const repostedResult = feed.results.find(
                (r) => r.post_id === repostedPost.id,
            );
            expect(repostedResult).toBeDefined();
            expect(repostedResult!.post_reposted_by_user).toBe(1);

            // Find not reposted post
            const notRepostedResult = feed.results.find(
                (r) => r.post_id === notRepostedPost.id,
            );
            expect(notRepostedResult).toBeDefined();
            expect(notRepostedResult!.post_reposted_by_user).toBe(0);
        });

        it('should correctly set author_followed_by_user flag', async () => {
            const feedService = new FeedService(client, moderationService);

            const viewerAccount =
                await createInternalAccount('follows-viewer.com');

            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            const followedAuthor = await createInternalAccount(
                'followed-author.com',
            );
            const unfollowedAuthor = await createInternalAccount(
                'unfollowed-author.com',
            );

            await client('account_topics').insert([
                { account_id: followedAuthor.id, topic_id: topicId },
                { account_id: unfollowedAuthor.id, topic_id: topicId },
            ]);

            // Viewer follows the first author
            await accountService.recordAccountFollow(
                followedAuthor as unknown as AccountType,
                viewerAccount as unknown as AccountType,
            );

            const followedAuthorPost = await createPost(followedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(followedAuthorPost);

            const unfollowedAuthorPost = await createPost(unfollowedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(unfollowedAuthorPost);

            // Add posts to discovery feeds
            await feedService.addPostToDiscoveryFeeds(
                followedAuthorPost as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                unfollowedAuthorPost as PublicPost,
            );

            const feed = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                10,
                null,
            );

            expect(feed.results).toHaveLength(2);

            // Find post from followed author
            const followedResult = feed.results.find(
                (r) => r.post_id === followedAuthorPost.id,
            );
            expect(followedResult).toBeDefined();
            expect(followedResult!.author_id).toBe(followedAuthor.id);
            expect(followedResult!.author_followed_by_user).toBe(1);

            // Find post from unfollowed author
            const unfollowedResult = feed.results.find(
                (r) => r.post_id === unfollowedAuthorPost.id,
            );
            expect(unfollowedResult).toBeDefined();
            expect(unfollowedResult!.author_id).toBe(unfollowedAuthor.id);
            expect(unfollowedResult!.author_followed_by_user).toBe(0);
        });

        it('should filter out posts from blocked authors', async () => {
            const feedService = new FeedService(client, moderationService);

            // Setup accounts
            const viewerAccount = await createInternalAccount(
                'moderation-viewer.com',
            );
            const blockedAuthor =
                await createInternalAccount('blocked-author.com');
            const allowedAuthor =
                await createInternalAccount('allowed-author.com');

            // Setup topics
            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            await client('account_topics').insert([
                { account_id: blockedAuthor.id, topic_id: topicId },
                { account_id: allowedAuthor.id, topic_id: topicId },
            ]);

            // Setup posts
            const blockedPost = await createPost(blockedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(blockedPost);

            const allowedPost = await createPost(allowedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(allowedPost);

            await feedService.addPostToDiscoveryFeeds(
                blockedPost as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                allowedPost as PublicPost,
            );

            // Block the author
            await fixtureManager.createBlock(viewerAccount, blockedAuthor);

            const feed = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                10,
                null,
            );

            // Should only see the allowed author's post
            expect(feed.results).toHaveLength(1);
            expect(feed.results[0].post_id).toBe(allowedPost.id);
            expect(feed.results[0].author_id).toBe(allowedAuthor.id);
        });

        it('should filter out posts from domain-blocked authors', async () => {
            const feedService = new FeedService(client, moderationService);

            // Setup accounts
            const viewerAccount = await createInternalAccount(
                'domain-moderation-viewer.com',
            );
            const blockedDomainAuthor1 =
                await createExternalAccount('blocked-domain.com');
            const blockedDomainAuthor2 =
                await createExternalAccount('blocked-domain.com');
            const allowedAuthor = await createInternalAccount(
                'allowed-domain-author.com',
            );

            // Setup topics
            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            await client('account_topics').insert([
                { account_id: blockedDomainAuthor1.id, topic_id: topicId },
                { account_id: blockedDomainAuthor2.id, topic_id: topicId },
                { account_id: allowedAuthor.id, topic_id: topicId },
            ]);

            // Setup posts
            const blockedPost1 = await createPost(blockedDomainAuthor1, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(blockedPost1);

            const blockedPost2 = await createPost(blockedDomainAuthor2, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(blockedPost2);

            const allowedPost = await createPost(allowedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(allowedPost);

            await feedService.addPostToDiscoveryFeeds(
                blockedPost1 as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                blockedPost2 as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                allowedPost as PublicPost,
            );

            // Block the domain
            await fixtureManager.createDomainBlock(
                viewerAccount,
                new URL('https://blocked-domain.com'),
            );

            const feed = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                10,
                null,
            );

            // Should only see the allowed author's post
            expect(feed.results).toHaveLength(1);
            expect(feed.results[0].post_id).toBe(allowedPost.id);
            expect(feed.results[0].author_id).toBe(allowedAuthor.id);
        });

        it('should handle both account and domain blocks together', async () => {
            const feedService = new FeedService(client, moderationService);

            // Setup accounts
            const viewerAccount = await createInternalAccount(
                'combined-moderation-viewer.com',
            );
            const accountBlockedAuthor = await createInternalAccount(
                'account-blocked.com',
            );
            const domainBlockedAuthor = await createExternalAccount(
                'domain-blocked-site.net',
            );
            const allowedAuthor = await createInternalAccount(
                'allowed-combined.com',
            );

            // Setup topics
            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            await client('account_topics').insert([
                { account_id: accountBlockedAuthor.id, topic_id: topicId },
                { account_id: domainBlockedAuthor.id, topic_id: topicId },
                { account_id: allowedAuthor.id, topic_id: topicId },
            ]);

            // Setup posts
            const accountBlockedPost = await createPost(accountBlockedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-01T10:00:00Z'),
            });
            await postRepository.save(accountBlockedPost);

            const domainBlockedPost = await createPost(domainBlockedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-02T10:00:00Z'),
            });
            await postRepository.save(domainBlockedPost);

            const allowedPost = await createPost(allowedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-03T10:00:00Z'),
            });
            await postRepository.save(allowedPost);

            await feedService.addPostToDiscoveryFeeds(
                accountBlockedPost as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                domainBlockedPost as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                allowedPost as PublicPost,
            );

            // Block the account
            await fixtureManager.createBlock(
                viewerAccount,
                accountBlockedAuthor,
            );

            // Block the domain
            await fixtureManager.createDomainBlock(
                viewerAccount,
                new URL('https://domain-blocked-site.net'),
            );

            const feed = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                10,
                null,
            );

            // Should only see the allowed author's post
            expect(feed.results).toHaveLength(1);
            expect(feed.results[0].post_id).toBe(allowedPost.id);
            expect(feed.results[0].author_id).toBe(allowedAuthor.id);
        });

        it('should correctly paginate with moderation filters', async () => {
            const feedService = new FeedService(client, moderationService);

            // Setup accounts
            const viewerAccount = await createInternalAccount(
                'pagination-moderation-viewer.com',
            );
            const blockedAuthor = await createInternalAccount(
                'pagination-blocked.com',
            );
            const allowedAuthor1 = await createInternalAccount(
                'pagination-allowed1.com',
            );
            const allowedAuthor2 = await createInternalAccount(
                'pagination-allowed2.com',
            );

            // Setup topics
            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            await client('account_topics').insert([
                { account_id: blockedAuthor.id, topic_id: topicId },
                { account_id: allowedAuthor1.id, topic_id: topicId },
                { account_id: allowedAuthor2.id, topic_id: topicId },
            ]);

            // Setup posts
            const allowedPost1 = await createPost(allowedAuthor1, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-03T10:00:00Z'),
            });
            await postRepository.save(allowedPost1);

            const blockedPost = await createPost(blockedAuthor, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-02T10:00:00Z'),
            });
            await postRepository.save(blockedPost);

            const allowedPost2 = await createPost(allowedAuthor2, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: new Date('2024-01-01T10:00:00Z'),
            });
            await postRepository.save(allowedPost2);

            await feedService.addPostToDiscoveryFeeds(
                allowedPost1 as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                blockedPost as PublicPost,
            );
            await feedService.addPostToDiscoveryFeeds(
                allowedPost2 as PublicPost,
            );

            // Block the author
            await fixtureManager.createBlock(viewerAccount, blockedAuthor);

            // Get first page with limit of 1
            const page1 = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                1,
                null,
            );

            // Should get the most recent allowed post
            expect(page1.results).toHaveLength(1);
            expect(page1.results[0].post_id).toBe(allowedPost1.id);
            expect(page1.nextCursor).not.toBeNull();

            // Get second page using cursor
            const page2 = await feedService.getDiscoveryFeedData(
                topicId,
                viewerAccount.id,
                1,
                page1.nextCursor,
            );

            // Should get the second allowed post (blocked post is skipped)
            expect(page2.results).toHaveLength(1);
            expect(page2.results[0].post_id).toBe(allowedPost2.id);
            expect(page2.nextCursor).toBeNull();
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
    });

    describe('addPostToDiscoveryFeeds', () => {
        it('should add articles to discovery feeds', async () => {
            const feedService = new FeedService(client, moderationService);

            const authorAccount = await createInternalAccount(
                'discovery-author.com',
            );

            // Create 3 topics
            const [technologyTopicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            const [programmingTopicId] = await client('topics').insert({
                name: 'Programming',
                slug: 'programming',
            });

            await client('topics').insert({
                name: 'Business',
                slug: 'business',
            });

            // Associate author with first 2 topics: Technology and Programming
            await client('account_topics').insert([
                { account_id: authorAccount.id, topic_id: technologyTopicId },
                { account_id: authorAccount.id, topic_id: programmingTopicId },
            ]);

            // Create an article
            const article = await createPost(authorAccount, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(article);

            // Add article to discovery feeds
            await feedService.addPostToDiscoveryFeeds(article as PublicPost);

            // Article should be on Technology and Programming topics, but not on Business
            const discoveryFeeds = await client('discovery_feeds')
                .where('post_id', article.id)
                .orderBy('topic_id');

            expect(discoveryFeeds).toHaveLength(2); // Not 3
            expect(discoveryFeeds[0]).toMatchObject({
                post_id: article.id,
                topic_id: technologyTopicId,
                author_id: authorAccount.id,
                post_type: PostType.Article,
            });
            expect(discoveryFeeds[1]).toMatchObject({
                post_id: article.id,
                topic_id: programmingTopicId,
                author_id: authorAccount.id,
                post_type: PostType.Article,
            });
        });

        it('should NOT add notes to discovery feeds', async () => {
            const feedService = new FeedService(client, moderationService);

            const authorAccount = await createInternalAccount(
                'discovery-note-author.com',
            );

            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            await client('account_topics').insert({
                account_id: authorAccount.id,
                topic_id: topicId,
            });

            // Create a note
            const note = await createPost(authorAccount, {
                type: PostType.Note,
                audience: Audience.Public,
            });
            await postRepository.save(note);

            // Add note to discovery feeds
            await feedService.addPostToDiscoveryFeeds(note as PublicPost);

            // Verify no entries were created
            const discoveryFeeds = await client('discovery_feeds').where(
                'post_id',
                note.id,
            );

            expect(discoveryFeeds).toHaveLength(0);
        });

        it('should NOT add replies to discovery feeds', async () => {
            const feedService = new FeedService(client, moderationService);

            const authorAccount = await createInternalAccount(
                'discovery-reply-author.com',
            );
            const otherAccount = await createInternalAccount(
                'discovery-other.com',
            );

            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            await client('account_topics').insert({
                account_id: authorAccount.id,
                topic_id: topicId,
            });

            // Parent post
            const originalPost = await createPost(otherAccount, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(originalPost);

            // Reply post
            const reply = await createPost(authorAccount, {
                type: PostType.Note,
                audience: Audience.Public,
                inReplyTo: originalPost,
            });
            await postRepository.save(reply);

            // Add reply to discovery feeds
            await feedService.addPostToDiscoveryFeeds(reply as PublicPost);

            // Verify no entries were created
            const discoveryFeeds = await client('discovery_feeds').where(
                'post_id',
                reply.id,
            );

            expect(discoveryFeeds).toHaveLength(0);
        });

        it('should use post published_at timestamp for discovery feed entries', async () => {
            const feedService = new FeedService(client, moderationService);
            const publishDate = new Date('2024-06-15T10:00:00Z');

            const authorAccount = await createInternalAccount(
                'discovery-timestamp.com',
            );

            const [topicId] = await client('topics').insert({
                name: 'Technology',
                slug: 'technology',
            });

            await client('account_topics').insert({
                account_id: authorAccount.id,
                topic_id: topicId,
            });

            // Create an article with specific publish date
            const article = await createPost(authorAccount, {
                type: PostType.Article,
                audience: Audience.Public,
                publishedAt: publishDate,
            });
            await postRepository.save(article);

            // Add to discovery feeds
            await feedService.addPostToDiscoveryFeeds(article as PublicPost);

            // Verify the published_at timestamp matches
            const discoveryFeed = await client('discovery_feeds')
                .where('post_id', article.id)
                .first();

            expect(discoveryFeed).toBeTruthy();
            expect(discoveryFeed.published_at).toEqual(publishDate);
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
            await feedService.removePostFromFeeds(followedAccountPost.id!);

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
            await feedService.removePostFromFeeds(post.id!, followedAccount.id);

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
            await feedService.removePostFromFeeds(post.id!, reposter1.id);

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

    describe('removePostFromDiscoveryFeeds', () => {
        it('should remove a post from discovery feeds', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create an internal account
            const account = await createInternalAccount('test-discovery.com');

            // Create topics and associate them with the account
            const topicIds = await Promise.all([
                client('topics').insert({
                    name: 'Technology',
                    slug: 'technology',
                }),
                client('topics').insert({ name: 'Science', slug: 'science' }),
            ]);

            await client('account_topics').insert([
                { account_id: account.id, topic_id: topicIds[0][0] },
                { account_id: account.id, topic_id: topicIds[1][0] },
            ]);

            // Create and save a post
            const post = await createPost(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(post);

            // Add the post to discovery feeds
            await feedService.addPostToDiscoveryFeeds(post as PublicPost);

            // Verify the post is in discovery feeds for both topics
            const discoveryFeedsBeforeRemoval = await client('discovery_feeds')
                .where('post_id', post.id)
                .select('topic_id');

            expect(discoveryFeedsBeforeRemoval.length).toBe(2);
            expect(discoveryFeedsBeforeRemoval.map((f) => f.topic_id)).toEqual(
                expect.arrayContaining([topicIds[0][0], topicIds[1][0]]),
            );

            // Remove the post from discovery feeds
            await feedService.removePostFromDiscoveryFeeds(post);

            // Verify the post is no longer in discovery feeds
            const discoveryFeedsAfterRemoval = await client('discovery_feeds')
                .where('post_id', post.id)
                .select('topic_id');

            expect(discoveryFeedsAfterRemoval.length).toBe(0);
        });

        it('should return empty array when removing a post that is not in any discovery feeds', async () => {
            const feedService = new FeedService(client, moderationService);

            // Create an internal account without topics
            const account = await createInternalAccount('test-no-topics.com');

            // Create and save a post
            const post = await createPost(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            await postRepository.save(post);

            // Remove the post from discovery feeds (should not error)
            await feedService.removePostFromDiscoveryFeeds(post);

            // Verify the post is not in any discovery feeds
            const discoveryFeeds = await client('discovery_feeds')
                .where('post_id', post.id)
                .select('topic_id');

            expect(discoveryFeeds.length).toBe(0);
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
