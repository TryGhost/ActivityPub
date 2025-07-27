import type { AppContext } from '../../app';
import type { SiteService } from '../../site/site.service';

export class SiteController {
    constructor(
        private readonly siteService: SiteService,
        private readonly ghostProIpAddresses?: string[],
    ) {}

    async handleGetSiteData(ctx: AppContext) {
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            ctx.get('logger').info('No Host header');
            return new Response(JSON.stringify({ error: 'No Host header' }), {
                status: 401,
            });
        }

        try {
            const isGhostPro = this.isRequestViaGhostPro(ctx);
            ctx.get('logger').info('isGhostPro: {isGhostPro}', { isGhostPro });
            const site = await this.siteService.initialiseSiteForHost(
                host,
                isGhostPro,
            );

            return new Response(JSON.stringify(site), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        } catch (error) {
            return new Response(
                error instanceof Error ? error.message : 'Unknown error',
                {
                    status: 500,
                },
            );
        }
    }

    private isRequestViaGhostPro(ctx: AppContext): boolean {
        const requestIps = this.getRequestIpAddresses(ctx);
        ctx.get('logger').info('requestIps: {requestIps}', { requestIps });
        if (!requestIps || requestIps.length === 0) {
            return false;
        }

        ctx.get('logger').info('ghostProIpAddresses: {ghostProIpAddresses}', {
            ghostProIpAddresses: this.ghostProIpAddresses,
        });
        const ghostProIps = this.ghostProIpAddresses;
        if (!ghostProIps || ghostProIps.length === 0) {
            return false;
        }

        return requestIps.some((ip) => ghostProIps.includes(ip));
    }

    private getRequestIpAddresses(ctx: AppContext): string[] | null {
        const forwardedFor = ctx.req.header('x-forwarded-for');

        if (!forwardedFor) {
            return null;
        }

        return forwardedFor.split(',').map((ip) => ip.trim());
    }
}
