import type { Account } from 'account/account.entity';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AppContext } from 'app';
import type { Next } from 'hono';
import type { SiteService } from 'site/site.service';

const ACCOUNT_RESOURCE_PREFIX = 'acct:';
const HOST_REGEX = /^[a-zA-Z0-9.-]+$/;

export class WebFingerController {
    constructor(
        private readonly siteService: SiteService,
        private readonly accountRepository: KnexAccountRepository,
    ) {}

    /**
     * Handle a webfinger request
     *
     * @param ctx App context
     * @param next Next middleware
     */
    async handleWebFinger(ctx: AppContext, next: Next) {
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
