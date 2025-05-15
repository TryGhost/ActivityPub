import type { AccountService } from 'account/account.service';
import { getAccountHandle } from 'account/utils';
import type { NotificationService } from 'notification/notification.service';
import type { AppContext } from '../../app';
import type { NotificationDTO } from './types';

const DEFAULT_NOTIFICATIONS_LIMIT = 20;
const MAX_NOTIFICATIONS_LIMIT = 100;

const notificationTypeMap: Record<number, NotificationDTO['type']> = {
    1: 'like',
    2: 'reply',
    3: 'repost',
    4: 'follow',
    5: 'mention',
};

const postTypeMap: Record<number, 'article' | 'note'> = {
    0: 'note',
    1: 'article',
};

/**
 * Create a handler for a request for a user's notifications
 *
 * @param accountService Account service instance
 */
export function createGetNotificationsHandler(
    accountService: AccountService,
    notificationService: NotificationService,
) {
    /**
     * Handle a request for a user's notifications
     *
     * @param ctx App context instance
     */
    return async function handleGetNotifications(ctx: AppContext) {
        const queryCursor = ctx.req.query('next');
        const cursor = queryCursor ? decodeURIComponent(queryCursor) : null;

        const queryLimit = ctx.req.query('limit');
        const limit = queryLimit
            ? Number(queryLimit)
            : DEFAULT_NOTIFICATIONS_LIMIT;

        if (limit > MAX_NOTIFICATIONS_LIMIT) {
            return new Response(null, {
                status: 400,
            });
        }

        const account = await accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );

        const { results, nextCursor } =
            await notificationService.getNotificationsData({
                accountId: account.id,
                limit,
                cursor,
            });

        const notifications: NotificationDTO[] = results.map((result) => {
            return {
                id: result.notification_id.toString(),
                createdAt: result.notification_created_at,
                type: notificationTypeMap[
                    Number(result.notification_event_type)
                ],
                actor: {
                    id: result.actor_id.toString(),
                    name: result.actor_name,
                    url: result.actor_url,
                    handle: getAccountHandle(
                        result.actor_url ? new URL(result.actor_url).host : '',
                        result.actor_username,
                    ),
                    avatarUrl: result.actor_avatar_url,
                },
                post: result.post_ap_id
                    ? {
                          id: result.post_ap_id,
                          type: postTypeMap[Number(result.post_type)],
                          title: result.post_title,
                          content: result.post_content,
                          url: result.post_url,
                          likeCount: result.post_like_count || 0,
                          likedByMe: result.post_liked_by_user === 1,
                          replyCount: result.post_reply_count || 0,
                          repostCount: result.post_repost_count || 0,
                          repostedByMe: result.post_reposted_by_user === 1,
                      }
                    : null,
                inReplyTo: result.in_reply_to_post_ap_id
                    ? {
                          id: result.in_reply_to_post_ap_id,
                          type: postTypeMap[
                              Number(result.in_reply_to_post_type)
                          ],
                          title: result.in_reply_to_post_title,
                          content: result.in_reply_to_post_content,
                          url: result.in_reply_to_post_url,
                      }
                    : null,
            };
        });

        return new Response(
            JSON.stringify({
                notifications,
                next: nextCursor ? String(nextCursor) : null,
            }),
            {
                status: 200,
            },
        );
    };
}
