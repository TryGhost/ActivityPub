import { IncomingMessage } from 'node:http';
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
            const requestIp = this.getRequestIp(ctx);
            const isGhostPro = this.isGhostProIp(requestIp);
            ctx.get('logger').info(
                'Request IP: {requestIp} (Ghost (Pro): {isGhostPro})',
                {
                    requestIp,
                    isGhostPro,
                },
            );
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

    private getRequestIp(ctx: AppContext): string | null {
        const forwardedFor = ctx.req.header('x-forwarded-for');
        if (forwardedFor) {
            return forwardedFor.split(',')[0].trim();
        }

        const req = ctx.req.raw;
        if (req instanceof IncomingMessage) {
            const remoteAddress = req.socket?.remoteAddress;
            if (remoteAddress) {
                return remoteAddress;
            }
        }

        return null;
    }

    private isGhostProIp(requestIp: string | null): boolean {
        if (!requestIp) {
            return false;
        }

        if (
            !this.ghostProIpAddresses ||
            this.ghostProIpAddresses.length === 0
        ) {
            return false;
        }

        return this.ghostProIpAddresses.includes(requestIp);
    }
}
