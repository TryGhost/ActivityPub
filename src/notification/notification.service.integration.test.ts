import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';
import { Audience, PostType } from 'post/post.entity';
import { createTestDb } from 'test/db';

import { NotificationService } from './notification.service';

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
});
