import type { Context as HonoContext, Next } from 'hono';

import type { Account } from 'account/account.entity';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { SiteService } from 'site/site.service';
import { Route } from '../decorators/route.decorator';

const ACCOUNT_RESOURCE_PREFIX = 'acct:';
const HOST_REGEX = /^([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z0-9]+)$/;

export class WebFingerController {
    constructor(
        private readonly accountRepository: KnexAccountRepository,
        private readonly siteService: SiteService,
    ) {}

    /**
     * Custom webfinger implementation to allow resources hosted on the www
     * version of a host to resolve to the non-www version of the host
     *
     * @see https://github.com/fedify-dev/fedify/blob/main/src/webfinger/handler.ts
     */
    @Route('GET', '/.well-known/webfinger')
    async handleWebFinger(ctx: HonoContext, next: Next) {
        const resource = ctx.req.query('resource');

        // We only support custom handling of `acct:` resources - If the
        // resource is not an `acct:` resource, fallback to the default
        // webfinger implementation
        if (!resource || !resource.startsWith(ACCOUNT_RESOURCE_PREFIX)) {
            return next();
        }

        const [_, resourceHost] = resource
            .slice(ACCOUNT_RESOURCE_PREFIX.length)
            .split('@');
        if (!resourceHost || !HOST_REGEX.test(resourceHost)) {
            return new Response(null, {
                status: 400,
            });
        }

        const site =
            (await this.siteService.getSiteByHost(resourceHost)) ||
            (await this.siteService.getSiteByHost(`www.${resourceHost}`));

        if (!site) {
            return new Response(null, {
                status: 404,
            });
        }

        let account: Account;

        try {
            account = await this.accountRepository.getBySite(site);
        } catch (error) {
            return new Response(null, {
                status: 404,
            });
        }

        const webfingerData = {
            subject: `acct:${account.username}@${site.host.replace('www.', '')}`,
            aliases: [account.apId.toString()],
            links: [
                {
                    rel: 'self',
                    href: account.apId.toString(),
                    type: 'application/activity+json',
                },
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: account.url.toString(),
                },
            ],
        };

        return new Response(JSON.stringify(webfingerData), {
            status: 200,
            headers: {
                'Content-Type': 'application/jrd+json',
            },
        });
    }
}
