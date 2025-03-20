import type { Knex } from 'knex';

import { sanitizeHtml } from 'helpers/html';

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
    post_id: number;
    post_type: string;
    post_title: string;
    post_content: string;
    post_url: string;
    post_ap_id: string;
    in_reply_to_post_id: number;
    in_reply_to_post_type: string;
    in_reply_to_post_title: string;
    in_reply_to_post_content: string;
    in_reply_to_post_url: string;
    in_reply_to_post_ap_id: string;
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
                'post.id as post_id',
                'post.title as post_title',
                'post.content as post_content',
                'post.url as post_url',
                // In reply to post fields
                'in_reply_to_post.id as in_reply_to_post_id',
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
}
