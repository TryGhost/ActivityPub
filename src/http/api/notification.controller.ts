import type { AccountService } from '@/account/account.service';
import { getAccountHandle } from '@/account/utils';
import type { AppContext } from '@/app';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import type { NotificationDTO } from '@/http/api/types';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import type { NotificationService } from '@/notification/notification.service';

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

export class NotificationController {
    constructor(
        private readonly accountService: AccountService,
        private readonly notificationService: NotificationService,
    ) {}

    @APIRoute('GET', 'notifications')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetNotifications(ctx: AppContext) {
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

        const account = ctx.get('account');

        const { results, nextCursor } =
            await this.notificationService.getNotificationsData({
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
                    followedByMe: result.actor_followed_by_user === 1,
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
                          attachments: (result.post_attachments || []).map(
                              (attachment) => ({
                                  type: attachment.type ?? '',
                                  mediaType: attachment.mediaType ?? '',
                                  name: attachment.name ?? '',
                                  url: attachment.url,
                              }),
                          ),
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
    }

    @APIRoute('GET', 'notifications/unread/count', 'stable', 'v1')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetUnreadNotificationsCount(ctx: AppContext) {
        const account = ctx.get('account');

        const unreadNotificationsCountResult =
            await this.notificationService.getUnreadNotificationsCount(
                account.id,
            );

        if (isError(unreadNotificationsCountResult)) {
            const error = getError(unreadNotificationsCountResult);
            switch (error) {
                case 'not-internal-account':
                    ctx.get('logger').error(
                        `Cannot get notifications count for external account ${account.id}`,
                    );
                    return new Response(null, { status: 500 });
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(
            JSON.stringify({
                count: getValue(unreadNotificationsCountResult),
            }),
            {
                status: 200,
            },
        );
    }

    @APIRoute('PUT', 'notifications/unread/reset')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleResetUnreadNotificationsCount(ctx: AppContext) {
        const account = ctx.get('account');

        await this.accountService.readAllNotifications(account);

        return new Response(null, {
            status: 200,
        });
    }
}
