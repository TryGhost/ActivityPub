import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';
import { Audience, PostType } from 'post/post.entity';
import type { Post } from 'post/post.entity';
import { createTestDb } from 'test/db';

import type { Account } from 'account/types';
import { NotificationService, NotificationType } from './notification.service';

describe('NotificationService', () => {
    let client: Knex;

    beforeAll(async () => {
        client = await createTestDb();
    });

    beforeEach(async () => {
        await client.raw('SET FOREIGN_KEY_CHECKS = 0');
        await client('notifications').truncate();
        await client('posts').truncate();
        await client('accounts').truncate();
        await client('users').truncate();
        await client('sites').truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');
    });

    describe('getNotificationsData', () => {
        it('should get the notifications for a user', async () => {
            const notificationService = new NotificationService(client);

            // Setup the user account
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
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
            });

            const [follower2AccountId] = await client('accounts').insert({
                username: 'charlie',
                ap_id: 'https://charlie.com/user/charlie',
                ap_inbox_url: 'https://charlie.com/user/charlie/inbox',
            });

            const [follower3AccountId] = await client('accounts').insert({
                username: 'dan',
                ap_id: 'https://dan.com/user/dan',
                ap_inbox_url: 'https://dan.com/user/dan/inbox',
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

            const notifications =
                await notificationService.getNotificationsData({
                    accountId,
                    limit: 10,
                    cursor: null,
                });

            expect(notifications.results).toHaveLength(4);
            await expect(notifications.results).toMatchFileSnapshot(
                './__snapshots__/get-notifications-data.json',
            );
        });

        it('should paginate the notifications', async () => {
            const notificationService = new NotificationService(client);

            // Setup the user account
            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
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
            });

            const [follower2AccountId] = await client('accounts').insert({
                username: 'charlie',
                ap_id: 'https://charlie.com/user/charlie',
                ap_inbox_url: 'https://charlie.com/user/charlie/inbox',
            });

            const [follower3AccountId] = await client('accounts').insert({
                username: 'dan',
                ap_id: 'https://dan.com/user/dan',
                ap_inbox_url: 'https://dan.com/user/dan/inbox',
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
            const notificationService = new NotificationService(client);

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
            const notificationService = new NotificationService(client);

            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
            });

            const [userId] = await client('users').insert({
                site_id: siteId,
                account_id: accountId,
            });

            const [followerAccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
            });

            const account = {
                id: accountId,
            } as Account;

            const followerAccount = {
                id: followerAccountId,
            } as Account;

            await notificationService.createFollowNotification(
                account,
                followerAccount,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(1);
            expect(notifications[0].user_id).toBe(userId);
            expect(notifications[0].account_id).toBe(followerAccountId);
            expect(notifications[0].event_type).toBe(NotificationType.Follow);
        });

        it('should do nothing if user is not found for account', async () => {
            const notificationService = new NotificationService(client);

            const accountWithoutUser = {
                id: 999,
            } as Account;

            const followerAccount = {
                id: 1,
            } as Account;

            await notificationService.createFollowNotification(
                accountWithoutUser,
                followerAccount,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });
    });

    describe('createLikeNotification', () => {
        it('should create a like notification', async () => {
            const notificationService = new NotificationService(client);

            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
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
            });

            const post = {
                id: userPostId,
                author: {
                    id: accountId,
                },
            } as Post;

            await notificationService.createLikeNotification(
                post,
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
            const notificationService = new NotificationService(client);

            const accountId = 123;

            const post = {
                id: 456,
                author: {
                    id: accountId,
                },
            } as Post;

            await notificationService.createLikeNotification(post, accountId);

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });

        it('should do nothing if user is not found for account', async () => {
            const notificationService = new NotificationService(client);

            const postWithAccountWithoutUser = {
                author: {
                    id: 999,
                },
            } as Post;

            await notificationService.createLikeNotification(
                postWithAccountWithoutUser,
                123,
            );

            const notifications = await client('notifications').select('*');

            expect(notifications).toHaveLength(0);
        });
    });

    describe('createRepostNotification', () => {
        it('should create a repost notification', async () => {
            const notificationService = new NotificationService(client);

            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
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
            const notificationService = new NotificationService(client);

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
            const notificationService = new NotificationService(client);

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
    });

    describe('createReplyNotification', () => {
        it('should create a reply notification', async () => {
            const notificationService = new NotificationService(client);

            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
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
            const notificationService = new NotificationService(client);

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
            const notificationService = new NotificationService(client);

            const [siteId] = await client('sites').insert({
                host: 'alice.com',
                webhook_secret: 'secret',
            });

            const [accountId] = await client('accounts').insert({
                username: 'alice',
                ap_id: 'https://alice.com/user/alice',
                ap_inbox_url: 'https://alice.com/user/alice/inbox',
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
            const notificationService = new NotificationService(client);

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
            const notificationService = new NotificationService(client);

            const [externalAccountId] = await client('accounts').insert({
                username: 'bob',
                ap_id: 'https://bob.com/user/bob',
                ap_inbox_url: 'https://bob.com/user/bob/inbox',
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
    });
});
