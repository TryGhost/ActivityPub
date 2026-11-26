import type { AccountService } from '@/account/account.service';
import type { AppContext } from '@/app';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

/**
 * Lets a site choose whether its public posts are sent to the relays
 * configured for the server (`RELAY_INBOXES`)
 */
export class RelayController {
    constructor(private readonly accountService: AccountService) {}

    @APIRoute('POST', 'actions/relay/enable', 'v2')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleEnable(ctx: AppContext) {
        await this.accountService.setRelaySharing(ctx.get('account'), true);

        return new Response(null, { status: 204 });
    }

    @APIRoute('POST', 'actions/relay/disable', 'v2')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleDisable(ctx: AppContext) {
        await this.accountService.setRelaySharing(ctx.get('account'), false);

        return new Response(null, { status: 204 });
    }
}
