import type { Context as HonoContext, Next } from 'hono';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { getAccountHandleHost, normalizeWebfingerHost } from '@/account/utils';
import { Route } from '@/http/decorators/route.decorator';
import type { SiteService } from '@/site/site.service';

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
        if (!resource?.startsWith(ACCOUNT_RESOURCE_PREFIX)) {
            return next();
        }

        const resourceParts = resource
            .slice(ACCOUNT_RESOURCE_PREFIX.length)
            .split('@');
        const [resourceUsername, resourceHost] = resourceParts;
        if (
            resourceParts.length !== 2 ||
            !resourceUsername ||
            !resourceHost ||
            !HOST_REGEX.test(resourceHost)
        ) {
            return new Response(null, {
                status: 400,
            });
        }

        const normalizedResourceHost = normalizeWebfingerHost(resourceHost);
        if (!normalizedResourceHost) {
            return new Response(null, {
                status: 400,
            });
        }

        const customDomainAccount =
            await this.accountRepository.getByWebfingerHandle(
                resourceUsername,
                normalizedResourceHost,
            );

        if (customDomainAccount) {
            return this.createWebfingerResponse(customDomainAccount);
        }

        const resourceLookup = await this.findAccountForHandleHost(
            resourceUsername,
            normalizedResourceHost,
        );

        if (resourceLookup.account) {
            return this.createWebfingerResponse(resourceLookup.account);
        }

        if (resourceLookup.siteFound) {
            return new Response(null, {
                status: 404,
            });
        }

        const requestHost = ctx.req.header('host')?.split(':')[0];
        const normalizedRequestHost = requestHost
            ? normalizeWebfingerHost(requestHost)
            : null;

        if (normalizedRequestHost === normalizedResourceHost) {
            return next();
        }

        if (normalizedRequestHost) {
            const requestLookup = await this.findAccountForHandleHost(
                resourceUsername,
                normalizedRequestHost,
            );

            if (requestLookup.account) {
                return this.createWebfingerResponse(
                    requestLookup.account,
                    normalizedResourceHost,
                );
            }
        }

        return new Response(null, {
            status: 404,
        });
    }

    /**
     * Find the account that answers to the requested username on either
     * variant of a handle host (`host` and `www.host`).
     *
     * Multiple site rows can exist for the same publication (e.g. a stale
     * registration left behind by a www/non-www domain change), so a
     * username mismatch on one variant must not prevent the other variant
     * from resolving. The bare host is checked first, so when both variants
     * match the requested username the bare host wins.
     */
    private async findAccountForHandleHost(
        resourceUsername: string,
        handleHost: string,
    ): Promise<{ siteFound: boolean; account: Account | null }> {
        let siteFound = false;

        for (const host of [handleHost, `www.${handleHost}`]) {
            const site = await this.siteService.getSiteByHost(host);

            if (!site) {
                continue;
            }

            siteFound = true;

            const account = await this.accountRepository.getBySite(site);

            if (
                account &&
                this.resourceUsernameMatchesAccount(resourceUsername, account)
            ) {
                return { siteFound, account };
            }
        }

        return { siteFound, account: null };
    }

    private createWebfingerResponse(
        account: Account,
        subjectHost = getAccountHandleHost(account).replace(/^www\./, ''),
    ) {
        const webfingerData = {
            subject: `acct:${account.username}@${subjectHost}`,
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

    private resourceUsernameMatchesAccount(
        resourceUsername: string,
        account: Account,
    ) {
        if (account.username === resourceUsername) {
            return true;
        }

        const actorUsername = account.apId.pathname
            .split('/')
            .filter(Boolean)
            .at(-1);

        return actorUsername === resourceUsername;
    }
}
