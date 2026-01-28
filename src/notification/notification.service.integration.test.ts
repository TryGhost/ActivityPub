import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { ModerationService } from '@/moderation/moderation.service';
import {
    NotificationService,
    NotificationType,
} from '@/notification/notification.service';
import type { Post } from '@/post/post.entity';
import { Audience, PostType } from '@/post/post.entity';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('NotificationService', () => {
    let client: Knex;
    let fixtureManager: FixtureManager;
    let moderationService: ModerationService;
    let notificationService: NotificationService;

    beforeAll(async () => {
        client = await createTestDb();
        fixtureManager = createFixtureManager(client);
        moderationService = new ModerationService(client);
        notificationService = new NotificationService(
            client,
            moderationService,
        );
    });

    beforeEach(async () => {
        await fixtureManager.reset();
    });

    describe('getNotificationsData', () => {
        it('should get the notifications for a user', async () => {
            // Setup the user account
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
                domain: 'alice.com',
            });

            const [userId] = await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [userPostId] = await client('posts').insert({
                author_id: accountId,
                type: PostType.Article,
                audience: Audience.Public,
                content:
                    'Velit culpa est amet nisi laboris aliqua cillum consectetur consequat duis excepteur esse non dolor irure.',
                url: 'http://alice.com/post/some-post',
                ap_id: 'https://alice.com/post/some-post',
                attachments: JSON.stringify({
                    url: 'https://example.com/image2.jpg',
                    type: 'image',
                    name: 'image2.jpg',
                }),
            });

            // Setup the follower accounts
            const [follower1AccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
                domain: 'bob.com',
            });

            const [follower2AccountId] = await client('accounts').insert({
                username: 'charlie',
                ap_id: 'https://charlie.com/user/charlie',
                ap_inbox_url: 'https://charlie.com/user/charlie/inbox',
                domain: 'charlie.com',
            });

            const [follower3AccountId] = await client('accounts').insert({
                username: 'dan',
                ap_id: 'https://dan.com/user/dan',
                ap_inbox_url: 'https://dan.com/user/dan/inbox',
                domain: 'dan.com',
            });

            const [follower1ReplyPostId] = await client('posts').insert({
                author_id: follower1AccountId,
                type: PostType.Note,
                audience: Audience.Public,
                content:
                    'Nostrud incididunt pariatur non exercitation exercitation exercitation esse nulla enim consectetur qui ea.',
                url: 'http://bob.com/post/some-reply',
                ap_id: 'https://bob.com/post/some-reply',
                like_count: 1,
                attachments: JSON.stringify([
                    {
                        url: 'https://example.com/image.jpg',
                        type: 'image',
                        name: 'example.jpg',
                    },
                ]),
            });

            const [follower2ReplyPostId] = await client('posts').insert({
                author_id: follower2AccountId,
                type: PostType.Note,
                audience: Audience.Public,
                content:
                    'Nostrud incididunt pariatur non exercitation exercitation exercitation esse nulla enim consectetur qui ea.',
                url: 'http://charlie.com/post/some-reply',
                ap_id: 'https://charlie.com/post/some-reply',
                repost_count: 1,
            });

            await client('likes').insert({
                account_id: userId,
                post_id: follower1ReplyPostId,
            });

            await client('reposts').insert({
                account_id: userId,
                post_id: follower2ReplyPostId,
            });

            await client('follows').insert({
                follower_id: userId,
                following_id: follower1AccountId,
            });

            // Setup the notifications
            await client('notifications').insert([
                // follower 1 likes user post
                {
                    user_id: userId,
                    account_id: follower1AccountId,
                    event_type: 1,
                    post_id: userPostId,
                    created_at: '2025-03-18 09:30:00',
                },
                // follower 2 reposts user post
                {
                    user_id: userId,
                    account_id: follower2AccountId,
                    event_type: 2,
                    post_id: userPostId,
                    created_at: '2025-03-18 16:55:00',
                },
                // follower 1 replies to user post
                {
                    user_id: userId,
                    account_id: follower1AccountId,
                    event_type: 3,
                    post_id: follower1ReplyPostId,
                    in_reply_to_post_id: userPostId,
                    created_at: '2025-03-20 11:05:00',
                },
                // follower 3 follows user
                {
                    user_id: userId,
                    account_id: follower3AccountId,
                    event_type: 4,
                    created_at: '2025-03-20 14:00:00',
                },
                {
                    user_id: userId,
                    account_id: follower2AccountId,
                    event_type: 3,
                    post_id: follower2ReplyPostId,
                    in_reply_to_post_id: userPostId,
                    created_at: '2025-03-21 11:00:00',
                },
            ]);

            const notifications =
                await notificationService.getNotificationsData({
                    accountId,
                    limit: 10,
                    cursor: null,
                });

            expect(notifications.results).toHaveLength(5);
            await expect(notifications.results).toMatchFileSnapshot(
                './__snapshots__/get-notifications-data.json',
            );
        });

        it('should paginate the notifications', async () => {
            // Setup the user account
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
                domain: 'alice.com',
            });

            const [userId] = await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [userPostId] = await client('posts').insert({
                author_id: accountId,
                type: PostType.Article,
                audience: Audience.Public,
                content:
                    'Velit culpa est amet nisi laboris aliqua cillum consectetur consequat duis excepteur esse non dolor irure.',
                url: 'http://alice.com/post/some-post',
                ap_id: 'https://alice.com/post/some-post',
            });

            // Setup the follower accounts
            const [follower1AccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
                domain: 'bob.com',
            });

            const [follower2AccountId] = await client('accounts').insert({
                username: 'charlie',
                ap_id: 'https://charlie.com/user/charlie',
                ap_inbox_url: 'https://charlie.com/user/charlie/inbox',
                domain: 'charlie.com',
            });

            const [follower3AccountId] = await client('accounts').insert({
                username: 'dan',
                ap_id: 'https://dan.com/user/dan',
                ap_inbox_url: 'https://dan.com/user/dan/inbox',
                domain: 'dan.com',
            });

            const [follower1ReplyPostId] = await client('posts').insert({
                author_id: follower1AccountId,
                type: PostType.Note,
                audience: Audience.Public,
                content:
                    'Nostrud incididunt pariatur non exercitation exercitation exercitation esse nulla enim consectetur qui ea.',
                url: 'http://bob.com/post/some-reply',
                ap_id: 'https://bob.com/post/some-reply',
            });

            // Setup the notifications
            await client('notifications').insert([
                // follower 1 likes user post
                {
                    user_id: userId,
                    account_id: follower1AccountId,
                    event_type: 1,
                    post_id: userPostId,
                    created_at: '2025-03-18 09:30:00',
                },
                // follower 2 reposts user post
                {
                    user_id: userId,
                    account_id: follower2AccountId,
                    event_type: 2,
                    post_id: userPostId,
                    created_at: '2025-03-18 16:55:00',
                },
                // follower 1 replies to user post
                {
                    user_id: userId,
                    account_id: follower1AccountId,
                    event_type: 3,
                    post_id: follower1ReplyPostId,
                    in_reply_to_post_id: userPostId,
                    created_at: '2025-03-20 11:05:00',
                },
                // follower 3 follows user
                {
                    user_id: userId,
                    account_id: follower3AccountId,
                    event_type: 4,
                    created_at: '2025-03-20 14:00:00',
                },
            ]);

            const firstPage = await notificationService.getNotificationsData({
                accountId,
                limit: 2,
                cursor: null,
            });

            expect(firstPage.results).toHaveLength(2);
            expect(firstPage.nextCursor).not.toBeNull();
            expect(firstPage.results[0].notification_id).toBe(4);
            expect(firstPage.results[1].notification_id).toBe(3);

            const secondPage = await notificationService.getNotificationsData({
                accountId,
                limit: 2,
                cursor: firstPage.nextCursor,
            });

            expect(secondPage.results).toHaveLength(2);
            expect(secondPage.nextCursor).toBeNull();
            expect(secondPage.results[0].notification_id).toBe(2);
            expect(secondPage.results[1].notification_id).toBe(1);
        });

        it('should throw an error if the user associated with the account does not exist', async () => {
            await expect(
                notificationService.getNotificationsData({
                    accountId: 123,
                    limit: 10,
                    cursor: null,
                }),
            ).rejects.toThrow('User not found for account: 123');
        });
    });

    describe('createFollowNotification', () => {
        it('should create a follow notification', async () => {
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
                domain: 'alice.com',
            });

            const [userId] = await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [followerAccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
                domain: 'bob.com',
            });

            await notificationService.createFollowNotification(
                accountId,
                followerAccountId,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(1);
            expect(notifications[0].user_id).toBe(userId);
            expect(notifications[0].account_id).toBe(followerAccountId);
            expect(notifications[0].event_type).toBe(NotificationType.Follow);
        });

        it('should do nothing if user is not found for account', async () => {
            await notificationService.createFollowNotification(999, 1);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if the follower account has been blocked by the user', async () => {
            const [[aliceAccount, ,], [bobAccount, ,]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createBlock(aliceAccount, bobAccount);

            await notificationService.createFollowNotification(
                aliceAccount.id,
                bobAccount.id,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });
    });

    describe('createLikeNotification', () => {
        it('should create a like notification', async () => {
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
                domain: 'alice.com',
            });

            const [userId] = await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [userPostId] = await client('posts').insert({
                author_id: accountId,
                type: PostType.Article,
                audience: Audience.Public,
                content:
                    'Velit culpa est amet nisi laboris aliqua cillum consectetur consequat duis excepteur esse non dolor irure.',
                url: 'http://alice.com/post/some-post',
                ap_id: 'https://alice.com/post/some-post',
            });

            const [likeAccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
                domain: 'bob.com',
            });

            await notificationService.createLikeNotification(
                userPostId,
                accountId,
                likeAccountId,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(1);
            expect(notifications[0].user_id).toBe(userId);
            expect(notifications[0].account_id).toBe(likeAccountId);
            expect(notifications[0].post_id).toBe(userPostId);
            expect(notifications[0].event_type).toBe(NotificationType.Like);
        });

        it('should do nothing if the account liking the post is the same as the post author', async () => {
            const accountId = 123;
            const postId = 456;

            await notificationService.createLikeNotification(
                postId,
                accountId,
                accountId,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if user is not found for account', async () => {
            const postId = 456;
            const postAuthorId = 999;
            const likerAccountId = 123;

            await notificationService.createLikeNotification(
                postId,
                postAuthorId,
                likerAccountId,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if the account liking the post has been blocked by the user', async () => {
            const [[aliceAccount, ,], [bobAccount, ,]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createBlock(aliceAccount, bobAccount);

            const post = await fixtureManager.createPost(aliceAccount);
            await notificationService.createLikeNotification(
                post.id as number,
                post.author.id as number,
                bobAccount.id as number,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });
    });

    describe('createRepostNotification', () => {
        it('should create a repost notification', async () => {
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
                domain: 'alice.com',
            });

            const [userId] = await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [userPostId] = await client('posts').insert({
                author_id: accountId,
                type: PostType.Article,
                audience: Audience.Public,
                content:
                    'Velit culpa est amet nisi laboris aliqua cillum consectetur consequat duis excepteur esse non dolor irure.',
                url: 'http://alice.com/post/some-post',
                ap_id: 'https://alice.com/post/some-post',
            });

            const [reposterAccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
                domain: 'bob.com',
            });

            const post = {
                id: userPostId,
                author: {
                    id: accountId,
                },
            } as Post;

            await notificationService.createRepostNotification(
                post,
                reposterAccountId,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(1);
            expect(notifications[0].user_id).toBe(userId);
            expect(notifications[0].account_id).toBe(reposterAccountId);
            expect(notifications[0].post_id).toBe(userPostId);
            expect(notifications[0].event_type).toBe(NotificationType.Repost);
        });

        it('should do nothing if the account reposting the post is the same as the post author', async () => {
            const accountId = 123;

            const post = {
                id: 456,
                author: {
                    id: accountId,
                },
            } as Post;

            await notificationService.createRepostNotification(post, accountId);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if user is not found for account', async () => {
            const postWithAccountWithoutUser = {
                author: {
                    id: 999,
                },
            } as Post;

            await notificationService.createRepostNotification(
                postWithAccountWithoutUser,
                123,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if the account reposting the post has been blocked by the user', async () => {
            const [[aliceAccount, ,], [bobAccount, ,]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createBlock(aliceAccount, bobAccount);

            const post = await fixtureManager.createPost(aliceAccount);

            await notificationService.createRepostNotification(
                post,
                bobAccount.id,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });
    });

    describe('createReplyNotification', () => {
        it('should create a reply notification', async () => {
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
                domain: 'alice.com',
            });

            const [userId] = await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [userPostId] = await client('posts').insert({
                author_id: accountId,
                type: PostType.Article,
                audience: Audience.Public,
                content:
                    'Velit culpa est amet nisi laboris aliqua cillum consectetur consequat duis excepteur esse non dolor irure.',
                url: 'http://alice.com/post/some-post',
                ap_id: 'https://alice.com/post/some-post',
            });

            const [replierAccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
                domain: 'bob.com',
            });

            const [replierPostId] = await client('posts').insert({
                author_id: replierAccountId,
                type: PostType.Article,
                audience: Audience.Public,
                content: 'Id ad adipisicing reprehenderit.',
                url: 'http://bob.com/post/some-reply',
                ap_id: 'https://bob.com/post/some-reply',
                in_reply_to: userPostId,
            });

            const post = {
                id: replierPostId,
                author: {
                    id: replierAccountId,
                },
                inReplyTo: userPostId,
            } as Post;

            await notificationService.createReplyNotification(post);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(1);
            expect(notifications[0].user_id).toBe(userId);
            expect(notifications[0].account_id).toBe(replierAccountId);
            expect(notifications[0].post_id).toBe(replierPostId);
            expect(notifications[0].in_reply_to_post_id).toBe(userPostId);
            expect(notifications[0].event_type).toBe(NotificationType.Reply);
        });

        it('should do nothing if the post is not a reply', async () => {
            const post = {
                id: 123,
                author: {
                    id: 456,
                },
                inReplyTo: null,
            } as Post;

            await expect(
                notificationService.createReplyNotification(post),
            ).resolves.not.toThrow();

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if the account replying to the post is the same as the post author', async () => {
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
                domain: 'alice.com',
            });

            await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [postId] = await client('posts').insert({
                author_id: accountId,
                type: PostType.Article,
                audience: Audience.Public,
                content:
                    'Velit culpa est amet nisi laboris aliqua cillum consectetur consequat duis excepteur esse non dolor irure.',
                url: 'http://alice.com/post/some-post',
                ap_id: 'https://alice.com/post/some-post',
            });

            const post = {
                id: 123,
                author: {
                    id: accountId,
                },
                inReplyTo: postId,
            } as Post;

            await notificationService.createReplyNotification(post);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should throw an error if the in reply to post is not found', async () => {
            const post = {
                id: 123,
                author: {
                    id: 456,
                },
                inReplyTo: 789,
            } as Post;

            await expect(
                notificationService.createReplyNotification(post),
            ).rejects.toThrow('In reply to post not found: 789');
        });

        it('should do nothing if user is not found for author of the in reply to post', async () => {
            const [externalAccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
                domain: 'bob.com',
            });

            const [externalAccountPostId] = await client('posts').insert({
                author_id: externalAccountId,
                type: PostType.Article,
                audience: Audience.Public,
                content:
                    'Velit culpa est amet nisi laboris aliqua cillum consectetur consequat duis excepteur esse non dolor irure.',
                url: 'http://bob.com/post/some-post',
                ap_id: 'https://bob.com/post/some-post',
            });

            const [anotherExternalAccountPostId] = await client('posts').insert(
                {
                    author_id: externalAccountId,
                    type: PostType.Article,
                    audience: Audience.Public,
                    content: 'Id ad adipisicing reprehenderit.',
                    url: 'http://bob.com/post/some-reply',
                    ap_id: 'https://bob.com/post/some-reply',
                    in_reply_to: externalAccountPostId,
                },
            );

            const post = {
                id: anotherExternalAccountPostId,
                author: {
                    id: externalAccountId,
                },
                inReplyTo: externalAccountPostId,
            } as Post;

            await notificationService.createReplyNotification(post);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if the account replying to the post has been blocked by the user', async () => {
            const [[aliceAccount, ,], [bobAccount, ,]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await fixtureManager.createBlock(aliceAccount, bobAccount);

            const post = await fixtureManager.createPost(aliceAccount, {
                type: PostType.Article,
            });

            const reply = await fixtureManager.createReply(bobAccount, post);

            await notificationService.createReplyNotification(reply);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });
    });

    describe('removeBlockedAccountNotifications', () => {
        it('should remove all notifications from a blocked account', async () => {
            // Create internal blocker account
            const [account, _site, userId] =
                await fixtureManager.createInternalAccount(null, 'alice.com');

            // Create an external account that will be blocked
            const blockedAccount = await fixtureManager.createExternalAccount();

            // Create some notifications from the blocked account
            await Promise.all([
                fixtureManager.createNotification(
                    account,
                    blockedAccount,
                    NotificationType.Like,
                ),
                fixtureManager.createNotification(
                    account,
                    blockedAccount,
                    NotificationType.Repost,
                ),
            ]);

            // Create a notification from another account to ensure it's not deleted
            const otherAccount = await fixtureManager.createExternalAccount();

            await fixtureManager.createNotification(
                account,
                otherAccount,
                NotificationType.Follow,
            );

            // Remove notifications from the blocked account
            await notificationService.removeBlockedAccountNotifications(
                account.id,
                blockedAccount.id,
            );

            // Verify only the blocked account's notifications were removed
            const remainingNotifications = await client('notifications')
                .where('user_id', userId)
                .select('*');

            expect(remainingNotifications).toHaveLength(1);
            expect(remainingNotifications[0].account_id).toBe(otherAccount.id);
        });

        it('should do nothing if user is not found for blocker account', async () => {
            const [account] = await fixtureManager.createInternalAccount(
                null,
                'alice.com',
            );

            const otherAccount = await fixtureManager.createExternalAccount();

            await Promise.all([
                fixtureManager.createNotification(
                    account,
                    otherAccount,
                    NotificationType.Like,
                ),
                fixtureManager.createNotification(
                    account,
                    otherAccount,
                    NotificationType.Repost,
                ),
            ]);

            await notificationService.removeBlockedAccountNotifications(
                999,
                otherAccount.id,
            );

            // Verify the existing notifications were not deleted
            const notifications = await client('notifications').select('*');
            expect(notifications).toHaveLength(2);
            expect(notifications[0].account_id).toBe(otherAccount.id);
            expect(notifications[1].account_id).toBe(otherAccount.id);
        });
    });

    describe('removeBlockedDomainNotifications', () => {
        it('should remove all notifications from accounts from a blocked domain', async () => {
            // Create internal blocker account
            const [account, _site, userId] =
                await fixtureManager.createInternalAccount(null, 'alice.com');

            // Create an external account that will have its domain blocked
            const blockedAccount = await fixtureManager.createExternalAccount();

            // Create some notifications from the blocked domain account
            await Promise.all([
                fixtureManager.createNotification(
                    account,
                    blockedAccount,
                    NotificationType.Like,
                ),
                fixtureManager.createNotification(
                    account,
                    blockedAccount,
                    NotificationType.Repost,
                ),
            ]);

            // Create a notification from another account to ensure it does not get deleted
            const otherAccount = await fixtureManager.createExternalAccount();

            await fixtureManager.createNotification(
                account,
                otherAccount,
                NotificationType.Follow,
            );

            // Remove notifications from the blocked domain
            await notificationService.removeBlockedDomainNotifications(
                account.id,
                blockedAccount.apId,
            );

            // Verify only the blocked domain account's notifications were removed
            const remainingNotifications = await client('notifications')
                .where('user_id', userId)
                .select('*');

            expect(remainingNotifications).toHaveLength(1);
            expect(remainingNotifications[0].account_id).toBe(otherAccount.id);
        });

        it('should do nothing if user is not found for blocker account', async () => {
            const [account] = await fixtureManager.createInternalAccount(
                null,
                'alice.com',
            );

            const otherAccount = await fixtureManager.createExternalAccount();

            await Promise.all([
                fixtureManager.createNotification(
                    account,
                    otherAccount,
                    NotificationType.Like,
                ),
                fixtureManager.createNotification(
                    account,
                    otherAccount,
                    NotificationType.Repost,
                ),
            ]);

            await notificationService.removeBlockedDomainNotifications(
                999,
                otherAccount.apId,
            );

            // Verify the existing notifications were not deleted
            const notifications = await client('notifications').select('*');
            expect(notifications).toHaveLength(2);
            expect(notifications[0].account_id).toBe(otherAccount.id);
            expect(notifications[1].account_id).toBe(otherAccount.id);
        });
    });

    describe('createMentionNotification', () => {
        it('should create a mention notification', async () => {
            // Delete existing mentions
            await client('mentions').delete();

            const [aliceAccount, ,] =
                await fixtureManager.createInternalAccount();
            const [bobAccount, , bobUserId] =
                await fixtureManager.createInternalAccount();

            const alicePost = await fixtureManager.createPost(aliceAccount, {
                type: PostType.Article,
            });

            await fixtureManager.createMention(bobAccount, alicePost);

            await notificationService.createMentionNotification(
                alicePost,
                bobAccount.id,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(1);
            expect(notifications[0].user_id).toBe(bobUserId);
            expect(notifications[0].account_id).toBe(aliceAccount.id);
            expect(notifications[0].post_id).toBe(alicePost.id);
            expect(notifications[0].event_type).toBe(NotificationType.Mention);
        });

        it('does not create a notification if the post is a reply to the author and also mentions the author', async () => {
            // Delete existing mentions
            await client('mentions').delete();

            const [aliceAccount, ,] =
                await fixtureManager.createInternalAccount();
            const [bobAccount, ,] =
                await fixtureManager.createInternalAccount();

            const bobPost = await fixtureManager.createPost(bobAccount, {
                type: PostType.Article,
            });

            const aliceReplyToBobPost = await fixtureManager.createReply(
                aliceAccount,
                bobPost,
            );

            await fixtureManager.createMention(bobAccount, aliceReplyToBobPost);

            await notificationService.createMentionNotification(
                aliceReplyToBobPost,
                bobAccount.id,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('does not create a notification if the post author is blocked', async () => {
            // Delete existing mentions
            await client('mentions').delete();

            const [aliceAccount, ,] =
                await fixtureManager.createInternalAccount();
            const [bobAccount, ,] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.createBlock(bobAccount, aliceAccount);

            const alicePost = await fixtureManager.createPost(aliceAccount, {
                type: PostType.Article,
            });

            await fixtureManager.createMention(bobAccount, alicePost);

            await notificationService.createMentionNotification(
                alicePost,
                bobAccount.id,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });
    });

    describe('removePostNotifications', () => {
        it('should remove all notifications for a given post', async () => {
            const [[aliceAccount, ,], [bobAccount, ,]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            const post = await fixtureManager.createPost(aliceAccount);
            const replyPost = await fixtureManager.createReply(
                bobAccount,
                post,
            );

            // Create multiple notifications for the post
            await Promise.all([
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Like,
                    post.id,
                ),
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Repost,
                    post.id,
                ),
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Mention,
                    post.id,
                ),
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Reply,
                    replyPost.id,
                    post.id,
                ),
            ]);

            // Create a notification for a different post to ensure it's not affected
            const otherPost = await fixtureManager.createPost(aliceAccount);
            await fixtureManager.createNotification(
                aliceAccount,
                bobAccount,
                NotificationType.Like,
                otherPost.id,
            );

            await notificationService.removePostNotifications(post);

            const remainingNotifications =
                await client('notifications').select('*');
            expect(remainingNotifications).toHaveLength(1); // One notification for the otherPost
            expect(remainingNotifications[0].post_id).toBe(otherPost.id);
        });
    });

    describe('readAllNotifications', () => {
        it('should mark all notifications as read', async () => {
            const [[aliceAccount, , aliceUserId], [bobAccount, ,]] =
                await Promise.all([
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                ]);

            // Create multiple unread notifications
            await Promise.all([
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Like,
                ),
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Repost,
                ),
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Mention,
                ),
            ]);

            // Create one read notification to ensure it stays read
            await fixtureManager.createNotification(
                aliceAccount,
                bobAccount,
                NotificationType.Follow,
            );
            await client('notifications')
                .where('user_id', aliceUserId)
                .update({ read: true });

            await notificationService.readAllNotifications(aliceAccount.id);

            const notifications = await client('notifications')
                .where('user_id', aliceUserId)
                .select('*');

            expect(notifications).toHaveLength(4);
            expect(notifications.every((n) => n.read)).toBe(true);
        });

        it('should do nothing if user is not found for account', async () => {
            const bobAccount = await fixtureManager.createExternalAccount();
            const [aliceAccount] = await fixtureManager.createInternalAccount();

            // Create some unread notifications
            await Promise.all([
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Like,
                ),
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Repost,
                ),
            ]);

            await notificationService.readAllNotifications(bobAccount.id);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(2);
            expect(notifications.every((n) => n.read)).toBe(false);
        });

        it('should only mark notifications for the specified user as read', async () => {
            const [[aliceAccount, , aliceUserId], [bobAccount, , bobUserId]] =
                await Promise.all([
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                ]);

            // Create unread notifications for both users
            await Promise.all([
                fixtureManager.createNotification(
                    aliceAccount,
                    bobAccount,
                    NotificationType.Like,
                ),
                fixtureManager.createNotification(
                    bobAccount,
                    aliceAccount,
                    NotificationType.Like,
                ),
            ]);

            await notificationService.readAllNotifications(aliceAccount.id);

            const aliceNotifications = await client('notifications')
                .where('user_id', aliceUserId)
                .select('*');
            const bobNotifications = await client('notifications')
                .where('user_id', bobUserId)
                .select('*');

            expect(aliceNotifications.every((n) => n.read)).toBe(true);
            expect(bobNotifications.every((n) => n.read)).toBe(false);
        });
    });
});
