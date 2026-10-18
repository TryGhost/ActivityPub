import type { AppContext } from '@/app';
import { getError, getValue, isError } from '@/core/result';
import { InternalServerError } from '@/http/api/helpers/response';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import type {
    BlueskyIntegrationDetails,
    BlueskyService,
} from '@/integration/bluesky.service';

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

function integrationResponse(details: BlueskyIntegrationDetails) {
    return jsonResponse({
        enabled: true,
        handleConfirmed: details.handleConfirmed,
        handle: details.handle,
        domainHandle: details.domainHandle,
    });
}

const NOT_ENABLED_RESPONSE_BODY = {
    error: 'Bluesky integration not enabled',
};

const NOT_CONFIRMED_RESPONSE_BODY = {
    error: 'Bluesky handle not confirmed',
};

export class BlueskyController {
    constructor(private readonly blueskyService: BlueskyService) {}

    @APIRoute('POST', 'actions/bluesky/enable', 'v2')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleEnable(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        let result: Awaited<ReturnType<BlueskyService['enableForAccount']>>;

        try {
            result = await this.blueskyService.enableForAccount(account);
        } catch (error) {
            logger.error('Failed to enable Bluesky integration', {
                error,
            });

            return InternalServerError('Failed to enable Bluesky integration');
        }

        return jsonResponse(result);
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

        let result: Awaited<
            ReturnType<BlueskyService['confirmHandleForAccount']>
        >;

        try {
            result = await this.blueskyService.confirmHandleForAccount(account);
        } catch (error) {
            logger.error('Failed to confirm Bluesky handle', { error });

            return InternalServerError('Failed to confirm Bluesky handle');
        }

        if (isError(result)) {
            const err = getError(result);

            if (err.type === 'not-enabled') {
                return jsonResponse(NOT_ENABLED_RESPONSE_BODY, 400);
            }

            logger.error('Failed to confirm Bluesky handle', {
                error: err,
            });

            return InternalServerError('Failed to confirm Bluesky handle');
        }

        return integrationResponse(getValue(result));
    }

    @APIRoute('POST', 'actions/bluesky/domain-handle', 'v2')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleRetryDomainHandle(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        let result: Awaited<
            ReturnType<BlueskyService['retryDomainHandleForAccount']>
        >;

        try {
            result =
                await this.blueskyService.retryDomainHandleForAccount(account);
        } catch (error) {
            logger.error('Failed to set up Bluesky domain handle', { error });

            return InternalServerError(
                'Failed to set up Bluesky domain handle',
            );
        }

        if (isError(result)) {
            const err = getError(result);

            if (err.type === 'not-enabled') {
                return jsonResponse(NOT_ENABLED_RESPONSE_BODY, 400);
            }

            if (err.type === 'not-confirmed') {
                return jsonResponse(NOT_CONFIRMED_RESPONSE_BODY, 400);
            }

            logger.error('Failed to set up Bluesky domain handle', {
                error: err,
            });

            return InternalServerError(
                'Failed to set up Bluesky domain handle',
            );
        }

        return integrationResponse(getValue(result));
    }

    @APIRoute('DELETE', 'actions/bluesky/domain-handle', 'v2')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleUseDefaultHandle(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        let result: Awaited<
            ReturnType<BlueskyService['useDefaultHandleForAccount']>
        >;

        try {
            result =
                await this.blueskyService.useDefaultHandleForAccount(account);
        } catch (error) {
            logger.error('Failed to switch to the default Bluesky handle', {
                error,
            });

            return InternalServerError(
                'Failed to switch to the default Bluesky handle',
            );
        }

        if (isError(result)) {
            const err = getError(result);

            return jsonResponse(
                err.type === 'not-enabled'
                    ? NOT_ENABLED_RESPONSE_BODY
                    : NOT_CONFIRMED_RESPONSE_BODY,
                400,
            );
        }

        return integrationResponse(getValue(result));
    }
}
