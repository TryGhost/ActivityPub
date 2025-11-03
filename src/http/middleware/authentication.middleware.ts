import type { Logger } from '@logtape/logtape';
import type { Context as HonoContext, Next } from 'hono';

import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import type {
    SiteAccountError,
    SiteAccountView,
} from '@/http/middleware/site-account.view';

export class AuthenticationMiddleware {
    constructor(
        private readonly siteAccountView: SiteAccountView,
        private readonly logger: Logger,
    ) {}

    async handle(ctx: HonoContext, next: Next) {
        const host = ctx.req.header('host');

        const result = await this.siteAccountView.getBySiteHost(host);

        if (isError(result)) {
            return this.handleError(ctx, getError(result));
        }

        const { site, account } = getValue(result);

        ctx.set('site', site);
        ctx.set('account', account);

        return next();
    }

    private handleError(ctx: HonoContext, error: SiteAccountError): Response {
        const logger = ctx.get('logger') || this.logger;

        switch (error.type) {
            case 'missing-host':
                logger.info('No Host header');
                return new Response('No Host header', {
                    status: 401,
                });

            case 'site-not-found':
                logger.info('No site found for {host}', { host: error.host });
                return new Response(
                    JSON.stringify({
                        error: 'Forbidden',
                        code: 'SITE_MISSING',
                    }),
                    {
                        status: 403,
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    },
                );

            case 'account-not-found':
                logger.error('No account found for {host}', {
                    host: error.host,
                });
                return new Response('No account found', {
                    status: 401,
                });

            default:
                exhaustiveCheck(error);
        }
    }
}
