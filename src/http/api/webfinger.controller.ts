import type { Context as HonoContext, Next } from 'hono';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { normalizeWebfingerHost } from '@/account/utils';
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
            return this.createWebfingerResponse(
                customDomainAccount,
                this.getSubjectHost(customDomainAccount, resourceHost),
            );
        }

        const site =
            (await this.siteService.getSiteByHost(normalizedResourceHost)) ||
            (await this.siteService.getSiteByHost(
                `www.${normalizedResourceHost}`,
            ));

        if (site) {
            const account = await this.getAccountBySiteOrNull(site);

            if (
                !account ||
                !this.resourceUsernameMatchesAccount(resourceUsername, account)
            ) {
                return new Response(null, {
                    status: 404,
                });
            }

            return this.createWebfingerResponse(
                account,
                this.getSubjectHost(account, resourceHost),
            );
        }

        const requestHost = ctx.req.header('host')?.split(':')[0];
        const normalizedRequestHost = requestHost
            ? normalizeWebfingerHost(requestHost)
            : null;

        if (normalizedRequestHost === normalizedResourceHost) {
            return next();
        }

        if (normalizedRequestHost) {
            const requestSite =
                (await this.siteService.getSiteByHost(normalizedRequestHost)) ||
                (await this.siteService.getSiteByHost(
                    `www.${normalizedRequestHost}`,
                ));

            if (requestSite) {
                const account = await this.getAccountBySiteOrNull(requestSite);

                if (
                    account &&
                    this.resourceUsernameMatchesAccount(
                        resourceUsername,
                        account,
                    )
                ) {
                    return this.createWebfingerResponse(
                        account,
                        normalizedResourceHost,
                    );
                }
            }
        }

        return new Response(null, {
            status: 404,
        });
    }

    private async getAccountBySiteOrNull(site: {
        id: number;
        host: string;
        webhook_secret: string;
        ghost_uuid: string | null;
    }) {
        try {
            return await this.accountRepository.getBySite(site);
        } catch (_error) {
            return null;
        }
    }

    /**
     * Resolve the host to use in the webfinger subject
     *
     * The subject host is only canonicalized to the non-www version of the
     * account host when the resource was queried via the non-www host — the
     * www version of a host cannot be unconditionally canonicalized to the
     * non-www version because the non-www version may be served by an
     * unrelated service (i.e another Fediverse server), in which case clients
     * verifying the subject would be directed to the wrong server
     */
    private getSubjectHost(account: Account, resourceHost: string) {
        if (account.webfingerHost) {
            return account.webfingerHost;
        }

        if (resourceHost.toLowerCase() === account.apId.host) {
            return account.apId.host;
        }

        return account.apId.host.replace(/^www\./, '');
    }

    private createWebfingerResponse(account: Account, subjectHost: string) {
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
