import type { Context } from 'hono';

import type { HonoContextVariables } from '../../app';
import type { SiteService } from '../../site/site.service';

// Make factory private
const getSiteDataHandler =
    (siteService: SiteService) =>
    async (ctx: Context<{ Variables: HonoContextVariables }>) => {
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            ctx.get('logger').info('No Host header');
            return new Response(JSON.stringify({ error: 'No Host header' }), {
                status: 401,
            });
        }

        const site = await siteService.initialiseSiteForHost(host);

        return new Response(JSON.stringify(site), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    };

// Export new class that uses the factory
export class SiteController {
    constructor(private readonly siteService: SiteService) {}

    handleGetSiteData = getSiteDataHandler(this.siteService);
}

// Keep exporting the factory for now to avoid breaking changes
export { getSiteDataHandler };
