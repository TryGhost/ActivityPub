import type { AppContext } from '@/app';
import { getError, getValue, isError } from '@/core/result';
import { InternalServerError } from '@/http/api/helpers/response';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import type { BlueskyService } from '@/integration/bluesky.service';

export class BlueskyController {
    constructor(private readonly blueskyService: BlueskyService) {}

    @APIRoute('POST', 'actions/bluesky/enable', 'v2')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleEnable(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        let result: {
            enabled: boolean;
            handleConfirmed: boolean;
            handle: string | null;
        };

        try {
            result = await this.blueskyService.enableForAccount(account);
        } catch (error) {
            logger.error('Failed to enable Bluesky integration', {
                error,
            });

            return InternalServerError('Failed to enable Bluesky integration');
        }

        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    @APIRoute('POST', 'actions/bluesky/disable', 'v2')
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

    @APIRoute('POST', 'actions/bluesky/confirm-handle', 'v2')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleConfirmHandle(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        const result =
            await this.blueskyService.confirmHandleForAccount(account);

        if (isError(result)) {
            const err = getError(result);

            if (err.type === 'not-enabled') {
                return new Response(
                    JSON.stringify({
                        error: 'Bluesky integration not enabled',
                    }),
                    {
                        status: 400,
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    },
                );
            }

            logger.error('Failed to confirm Bluesky handle', {
                error: err,
            });

            return InternalServerError('Failed to confirm Bluesky handle');
        }

        const { handleConfirmed, handle } = getValue(result);

        return new Response(
            JSON.stringify({
                enabled: true,
                handleConfirmed,
                handle,
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            },
        );
    }
}
