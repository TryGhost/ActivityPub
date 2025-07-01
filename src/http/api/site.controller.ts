import type { AppContext } from 'app';
import type { SiteService } from 'site/site.service';

export class SiteController {
    constructor(private readonly siteService: SiteService) {}

    /**
     * Handle a request for site data
     *
     * @param ctx App context
     */
    async handleGetSiteData(ctx: AppContext) {
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            ctx.get('logger').info('No Host header');
            return new Response(JSON.stringify({ error: 'No Host header' }), {
                status: 401,
            });
        }

        const site = await this.siteService.initialiseSiteForHost(host);

        return new Response(JSON.stringify(site), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
}
