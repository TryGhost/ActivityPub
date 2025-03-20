import type { AccountService } from 'account/account.service';
import { getAccountHandle } from 'account/utils';
import type { NotificationService } from 'notification/notification.service';
import type { AppContext } from '../../app';
import type { NotificationDTO } from './types';

const DEFAULT_NOTIFICATIONS_LIMIT = 20;
const MAX_NOTIFICATIONS_LIMIT = 100;

const notificationTypeMap: Record<number, NotificationDTO['type']> = {
    1: 'like',
    2: 'repost',
    3: 'reply',
    4: 'follow',
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
                post: result.post_id
                    ? {
                          id: result.post_id.toString(),
                          title: result.post_title,
                          content: result.post_content,
                          url: result.post_url,
                      }
                    : null,
                inReplyTo: result.in_reply_to_post_id
                    ? {
                          id: result.in_reply_to_post_id.toString(),
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
                next: nextCursor,
            }),
            {
                status: 200,
            },
        );
    };
}
