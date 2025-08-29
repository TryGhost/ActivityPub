import type { AppContext } from '@/app';
import { InternalServerError } from '@/http/api/helpers/response';
import { RequireRoles, Route } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import type { BlueskyService } from '@/integration/bluesky.service';

export class BlueskyController {
    constructor(private readonly blueskyService: BlueskyService) {}

    @Route('POST', '/.ghost/activitypub/v1/actions/bluesky/enable')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleEnable(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        let handle: string;

        try {
            handle = await this.blueskyService.enableForAccount(account);
        } catch (error) {
            logger.error('Failed to enable Bluesky integration', {
                error,
            });

            return InternalServerError('Failed to enable Bluesky integration');
        }

        return new Response(JSON.stringify({ handle }), {
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    @Route('POST', '/.ghost/activitypub/v1/actions/bluesky/disable')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleDisable(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        try {
            await this.blueskyService.disableForAccount(account);
        } catch (error) {
            logger.error('Failed to disable Bluesky integration', {
                error,
            });

            return InternalServerError('Failed to disable Bluesky integration');
        }

        return new Response(null, {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 204,
        });
    }
}
