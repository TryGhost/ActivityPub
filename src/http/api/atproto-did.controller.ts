import type { Context as HonoContext } from 'hono';

import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { BlueskyService } from '@/integration/bluesky.service';
import type { SiteService } from '@/site/site.service';

export const ATPROTO_DID_PATH = '/.well-known/atproto-did';

/**
 * Serves the DID of a site's bridged Bluesky account, so the site's domain
 * can be its Bluesky handle
 *
 * @see https://atproto.com/specs/handle#https-well-known-method
 */
export class AtprotoDidController {
    constructor(
        private readonly siteService: SiteService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly blueskyService: BlueskyService,
    ) {}

    async handleGetAtprotoDid(ctx: HonoContext) {
        const host = ctx.req.header('host')?.toLowerCase();

        if (!host) {
            return this.notFound();
        }

        // Root domain handle lookups can reach us on the root domain when the
        // proxy serves both it and `www.` for a site on `www.`, or the other
        // way round. The other host can be a different site though (eg one
        // left behind by a www/non-www domain change), so its DID is only
        // served for a claim on the requested host
        const counterpart = host.startsWith('www.')
            ? host.slice('www.'.length)
            : `www.${host}`;

        for (const candidate of [host, counterpart]) {
            const site = await this.siteService.getSiteByHost(candidate);

            if (!site) {
                continue;
            }

            const account = await this.accountRepository.getBySite(site);

            if (!account) {
                continue;
            }

            const did = await this.blueskyService.getDomainHandleDid(
                account,
                candidate === host ? undefined : host,
            );

            if (did) {
                return new Response(did, {
                    headers: {
                        'Content-Type': 'text/plain',
                    },
                });
            }
        }

        return this.notFound();
    }

    private notFound() {
        return new Response('Not Found', {
            status: 404,
            headers: {
                'Content-Type': 'text/plain',
            },
        });
    }
}
