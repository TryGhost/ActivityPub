import type { Knex } from 'knex';

import type { Account } from 'account/types';
import { sanitizeHtml } from 'helpers/html';
import type { Post } from 'post/post.entity';

export enum NotificationType {
    Like = 1,
    Reply = 2,
    Repost = 3,
    Follow = 4,
}

export interface GetNotificationsDataOptions {
    /**
     * ID of the account associated with the user to get the notifications for
     */
    accountId: number;
    /**
     * Maximum number of notifications to return
     */
    limit: number;
    /**
     * Cursor to use for pagination
     */
    cursor: string | null;
}

interface BaseGetNotificationsDataResultRow {
    notification_id: number;
    notification_created_at: Date;
    notification_event_type: string;
    actor_id: number;
    actor_name: string;
    actor_username: string;
    actor_url: string;
    actor_avatar_url: string;
    post_ap_id: string;
    post_type: string;
    post_title: string;
    post_content: string;
    post_url: string;
    in_reply_to_post_ap_id: string;
    in_reply_to_post_type: string;
    in_reply_to_post_title: string;
    in_reply_to_post_content: string;
    in_reply_to_post_url: string;
}

export interface GetNotificationsDataResult {
    results: BaseGetNotificationsDataResultRow[];
    nextCursor: string | null;
}

export class NotificationService {
    /**
     * @param db Database client
     */
    constructor(private readonly db: Knex) {}

    /**
     * Get data for a notifications based on the provided options
     *
     * @param options Options for the query
     */
    async getNotificationsData(
        options: GetNotificationsDataOptions,
    ): Promise<GetNotificationsDataResult> {
        const user = await this.db('users')
            .where('account_id', options.accountId)
            .select('id')
            .first();

        if (!user) {
            throw new Error(`User not found for account: ${options.accountId}`);
        }

        const query = this.db('notifications')
            .select(
                // Notification fields
                'notifications.id as notification_id',
                'notifications.created_at as notification_created_at',
                'notifications.event_type as notification_event_type',
                // Actor fields
                'actor_account.id as actor_id',
                'actor_account.name as actor_name',
                'actor_account.username as actor_username',
                'actor_account.url as actor_url',
                'actor_account.avatar_url as actor_avatar_url',
                // Post fields
                'post.ap_id as post_ap_id',
                'post.type as post_type',
                'post.title as post_title',
                'post.content as post_content',
                'post.url as post_url',
                // In reply to post fields
                'in_reply_to_post.ap_id as in_reply_to_post_ap_id',
                'in_reply_to_post.type as in_reply_to_post_type',
                'in_reply_to_post.title as in_reply_to_post_title',
                'in_reply_to_post.content as in_reply_to_post_content',
                'in_reply_to_post.url as in_reply_to_post_url',
            )
            .innerJoin(
                'accounts as actor_account',
                'actor_account.id',
                'notifications.account_id',
            )
            .leftJoin('posts as post', 'post.id', 'notifications.post_id')
            .leftJoin(
                'posts as in_reply_to_post',
                'in_reply_to_post.id',
                'notifications.in_reply_to_post_id',
            )
            .where('notifications.user_id', user.id)
            .modify((query) => {
                if (options.cursor) {
                    query.where('notifications.id', '<', options.cursor);
                }
            })
            .orderBy('notifications.id', 'desc')
            .limit(options.limit + 1);

        const results = await query;

        const hasMore = results.length > options.limit;
        const paginatedResults = results.slice(0, options.limit);
        const lastResult = paginatedResults[paginatedResults.length - 1];

        return {
            results: paginatedResults.map(
                (item: BaseGetNotificationsDataResultRow) => {
                    return {
                        ...item,
                        post_content: sanitizeHtml(item.post_content ?? ''),
                        in_reply_to_post_content: sanitizeHtml(
                            item.in_reply_to_post_content ?? '',
                        ),
                    };
                },
            ),
            nextCursor: hasMore ? lastResult.notification_id : null,
        };
    }

    /**
     * Create a notification for an account being followed
     *
     * @param account The account that is being followed
     * @param followerAccount The account that is following
     */
    async createFollowNotification(account: Account, followerAccount: Account) {
        const user = await this.db('users')
            .where('account_id', account.id)
            .select('id')
            .first();

        if (!user) {
            // If this follow was for an internal account that doesn't exist,
            // or an external account, we can't create a notification for it as
            // there is not a corresponding user record in the database
            return;
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: followerAccount.id,
            event_type: NotificationType.Follow,
        });
    }

    /**
     * Create a notification for a post being liked
     *
     * @param post The post that is being liked
     * @param accountId The ID of the account that is liking the post
     */
    async createLikeNotification(post: Post, accountId: number) {
        const user = await this.db('users')
            .where('account_id', post.author.id)
            .select('id')
            .first();

        if (!user) {
            // If this like was for a post by an internal account that no longer
            // exists, or an external account, we can't create a notification for
            // it as there is not a corresponding user record in the database
            return;
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: accountId,
            post_id: post.id,
            event_type: NotificationType.Like,
        });
    }

    /**
     * Create a notification for a post being reposted
     *
     * @param post The post that is being reposted
     * @param accountId The ID of the account that is reposting the post
     */
    async createRepostNotification(post: Post, accountId: number) {
        const user = await this.db('users')
            .where('account_id', post.author.id)
            .select('id')
            .first();

        if (!user) {
            // If this repost was for a post by an internal account that no longer
            // exists, or an external account, we can't create a notification for
            // it as there is not a corresponding user record in the database
            return;
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: accountId,
            post_id: post.id,
            event_type: NotificationType.Repost,
        });
    }

    /**
     * Create a notification for a post being replied to
     *
     * @param post The post that is being replied to
     */
    async createReplyNotification(post: Post) {
        if (post.inReplyTo === null) {
            // This post is not reply, exit early
            return;
        }

        const inReplyToPost = await this.db('posts')
            .where('id', post.inReplyTo)
            .select('id', 'author_id')
            .first();

        if (!inReplyToPost) {
            throw new Error(`In reply to post not found: ${post.inReplyTo}`);
        }

        const user = await this.db('users')
            .where('account_id', inReplyToPost.author_id)
            .select('id')
            .first();

        if (!user) {
            // If this reply was for a post by an internal account that no longer
            // exists, or an external account, we can't create a notification for
            // it as there is not a corresponding user record in the database
            return;
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: post.author.id,
            post_id: post.id,
            in_reply_to_post_id: inReplyToPost.id,
            event_type: NotificationType.Reply,
        });
    }
}
