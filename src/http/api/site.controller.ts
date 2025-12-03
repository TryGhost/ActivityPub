import type { AppContext } from '@/app';
import type { SiteService } from '@/site/site.service';

export class SiteController {
    constructor(
        private readonly siteService: SiteService,
        private readonly ghostProIpAddresses?: string[],
    ) {}

    async handleGetSiteData(ctx: AppContext) {
        const logger = ctx.get('logger');
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            logger.info('No Host header');
            return new Response(JSON.stringify({ error: 'No Host header' }), {
                status: 401,
            });
        }

        try {
            const isGhostPro = this.isRequestViaGhostPro(ctx);
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
            logger.error('Failed to get site data', { error });
            return new Response(
                error instanceof Error ? error.message : 'Unknown error',
                {
                    status: 500,
                },
            );
        }
    }

    async handleDisableSite(ctx: AppContext) {
        const logger = ctx.get('logger');
        const host = ctx.req.header('host');

        if (!host) {
            logger.info('No Host header');

            return new Response(JSON.stringify({ error: 'No Host header' }), {
                status: 401,
            });
        }

        try {
            const wasDisabled = await this.siteService.disableSiteForHost(host);

            if (wasDisabled) {
                return new Response(null, {
                    status: 200,
                });
            }

            return new Response(null, {
                status: 404,
            });
        } catch (error) {
            logger.error('Site could not be disabled', { error });

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
        if (!requestIps || requestIps.length === 0) {
            return false;
        }

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
