import type { AccountService } from 'account/account.service';
import type { NotificationService } from 'notification/notification.service';
import type { AppContext } from '../../app';
import type { NotificationDTO } from './types';

const DEFAULT_NOTIFICATIONS_LIMIT = 20;
const MAX_NOTIFICATIONS_LIMIT = 100;

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
            return { id: result.id.toString() };
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
