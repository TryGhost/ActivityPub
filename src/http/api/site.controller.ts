import type { AccountService } from '@/account/account.service';
import { getAccountHandle, getAccountHandleHost } from '@/account/utils';
import type { AppContext } from '@/app';
import type { SiteService } from '@/site/site.service';

export class SiteController {
    constructor(
        private readonly siteService: SiteService,
        private readonly ghostProIpAddresses?: string[],
        private readonly accountService?: AccountService,
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

            let responseBody: object = site;

            if (this.accountService) {
                const account =
                    await this.accountService.getAccountForSite(site);

                if (account) {
                    responseBody = {
                        ...site,
                        domain: getAccountHandleHost(account),
                        handle: getAccountHandle(
                            getAccountHandleHost(account),
                            account.username,
                        ),
                        actorUrl: account.apId.href,
                    };
                }
            }

            return new Response(JSON.stringify(responseBody), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        } catch (error) {
            logger.error('Failed to get site data: {error} for host {host}', {
                error,
                host,
            });
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
