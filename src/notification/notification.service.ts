import type { Knex } from 'knex';

import { error, ok, type Result } from '@/core/result';
import { sanitizeHtml } from '@/helpers/html';
import type { ModerationService } from '@/moderation/moderation.service';
import type { Post } from '@/post/post.entity';

export enum NotificationType {
    Like = 1,
    Reply = 2,
    Repost = 3,
    Follow = 4,
    Mention = 5,
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
    actor_followed_by_user: 0 | 1;
    post_ap_id: string;
    post_type: string;
    post_title: string;
    post_content: string;
    post_url: string;
    post_like_count: number;
    post_liked_by_user: 0 | 1;
    post_reply_count: number;
    post_repost_count: number;
    post_reposted_by_user: 0 | 1;
    post_attachments:
        | {
              type: string | null;
              mediaType: string | null;
              name: string | null;
              url: string;
          }[]
        | null;
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

type GetUnreadNotificationsCountError = 'not-internal-account';

export class NotificationService {
    constructor(
        private readonly db: Knex,
        private readonly moderationService: ModerationService,
    ) {}

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
                this.db.raw(`
                    CASE
                        WHEN follows_actor.following_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS actor_followed_by_user
                `),
                // Post fields
                'post.ap_id as post_ap_id',
                'post.type as post_type',
                'post.title as post_title',
                'post.content as post_content',
                'post.url as post_url',
                'post.like_count as post_like_count',
                'post.attachments as post_attachments',
                this.db.raw(`
                    CASE
                        WHEN post_likes.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_liked_by_user
                `),
                'post.reply_count as post_reply_count',
                'post.repost_count as post_repost_count',
                this.db.raw(`
                    CASE
                        WHEN post_reposts.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_reposted_by_user
                `),
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
            .leftJoin('likes as post_likes', function () {
                this.onVal(
                    'post_likes.account_id',
                    '=',
                    options.accountId.toString(),
                ).andOn('post_likes.post_id', 'post.id');
            })
            .leftJoin('reposts as post_reposts', function () {
                this.onVal(
                    'post_reposts.account_id',
                    '=',
                    options.accountId.toString(),
                ).andOn('post_reposts.post_id', 'post.id');
            })
            .leftJoin('follows as follows_actor', function () {
                this.on(
                    'follows_actor.following_id',
                    'actor_account.id',
                ).andOnVal(
                    'follows_actor.follower_id',
                    '=',
                    options.accountId.toString(),
                );
            })
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

    async createFollowNotification(
        accountId: number,
        followerAccountId: number,
    ) {
        const user = await this.db('users')
            .where('account_id', accountId)
            .select('id')
            .first();

        if (!user) {
            // If this follow was for an internal account that doesn't exist,
            // or an external account, we can't create a notification for it as
            // there is not a corresponding user record in the database
            return;
        }

        const notificationAllowed =
            await this.moderationService.canInteractWithAccount(
                followerAccountId,
                accountId,
            );

        if (!notificationAllowed) {
            return;
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: followerAccountId,
            event_type: NotificationType.Follow,
        });
    }

    /**
     * Create a notification for a post being liked
     *
     * @param postId The ID of the post that is being liked
     * @param postAuthorId The ID of the post author's account
     * @param accountId The ID of the account that is liking the post
     */
    async createLikeNotification(
        postId: number,
        postAuthorId: number,
        accountId: number,
    ) {
        if (postAuthorId === accountId) {
            // Do not create a notification for a post created by the same account
            // that is liking it
            return;
        }

        const user = await this.db('users')
            .where('account_id', postAuthorId)
            .select('id')
            .first();

        if (!user) {
            // If this like was for a post by an internal account that no longer
            // exists, or an external account, we can't create a notification for
            // it as there is not a corresponding user record in the database
            return;
        }

        const notificationAllowed =
            await this.moderationService.canInteractWithAccount(
                accountId,
                postAuthorId,
            );

        if (!notificationAllowed) {
            return;
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: accountId,
            post_id: postId,
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
        if (post.author.id === accountId) {
            // Do not create a notification for a repost by the author of the post
            return;
        }

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

        const notificationAllowed =
            await this.moderationService.canInteractWithAccount(
                accountId,
                post.author.id,
            );

        if (!notificationAllowed) {
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

        if (post.author.id === inReplyToPost.author_id) {
            // Do not create a notification for a reply by the author of the
            // original post
            return;
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

        const notificationAllowed =
            await this.moderationService.canInteractWithAccount(
                post.author.id,
                inReplyToPost.author_id,
            );

        if (!notificationAllowed) {
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

    async removeBlockedAccountNotifications(
        blockerAccountId: number,
        blockedAccountId: number,
    ) {
        const user = await this.db('users')
            .where('account_id', blockerAccountId)
            .select('id')
            .first();

        if (!user) {
            // If this block was for an internal account that doesn't exist,
            // or an external account, we can't remove notifications for it as
            // there is not a corresponding user record in the database
            return;
        }

        await this.db('notifications')
            .where('user_id', user.id)
            .andWhere('account_id', blockedAccountId)
            .delete();
    }

    async removePostNotifications(post: Post) {
        await this.db('notifications')
            .where('post_id', post.id)
            .orWhere('in_reply_to_post_id', post.id)
            .delete();
    }

    async removeBlockedDomainNotifications(blockerId: number, domain: URL) {
        const user = await this.db('users')
            .where('account_id', blockerId)
            .select('id')
            .first();

        if (!user) {
            // If this block was for an internal account that doesn't exist,
            // or an external account, we can't remove notifications for it as
            // there is not a corresponding user record in the database
            return;
        }

        await this.db('notifications')
            .join('accounts', 'notifications.account_id', 'accounts.id')
            .where('notifications.user_id', user.id)
            .andWhereRaw('accounts.domain_hash = UNHEX(SHA2(LOWER(?), 256))', [
                domain.host,
            ])
            .delete();
    }

    async createMentionNotification(post: Post, accountId: number) {
        if (post.author.id === accountId) {
            // Do not create a notification if author mentioned themselves (lol)
            return;
        }

        if (post.inReplyTo) {
            // Do not create a notification if the post is a reply to Bob and also mentions Bob
            const inReplyToPost = await this.db('posts')
                .where('id', post.inReplyTo)
                .select('id', 'author_id')
                .first();

            if (inReplyToPost.author_id === accountId) {
                return;
            }
        }

        const user = await this.db('users')
            .where('account_id', accountId)
            .select('id')
            .first();

        if (!user) {
            // If the mention is for an account that no longer exists or is external,
            // don't create a notification
            return;
        }

        const notificationAllowed =
            await this.moderationService.canInteractWithAccount(
                post.author.id,
                accountId,
            );

        if (!notificationAllowed) {
            return;
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: post.author.id,
            post_id: post.id,
            event_type: NotificationType.Mention,
        });
    }

    async getUnreadNotificationsCount(
        accountId: number,
    ): Promise<Result<number, GetUnreadNotificationsCountError>> {
        const user = await this.db('users')
            .where('account_id', accountId)
            .select('id')
            .first();

        if (!user) {
            return error('not-internal-account');
        }

        const result = await this.db('notifications')
            .where('user_id', user.id)
            .andWhere('read', false)
            .count('*', { as: 'count' });

        return ok(Number(result[0].count));
    }

    async readAllNotifications(accountId: number) {
        const user = await this.db('users')
            .where('account_id', accountId)
            .select('id')
            .first();

        if (!user) {
            // If the requested account no longer exists or is external, don't read all notifications
            return;
        }

        await this.db('notifications')
            .where('user_id', user.id)
            .andWhere('read', false)
            .update({
                read: true,
            });
    }
}
