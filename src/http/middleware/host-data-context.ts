import type { Context as HonoContext, Next } from 'hono';

import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import type { HostDataContextLoader } from '@/http/host-data-context-loader';

export function createHostDataContextMiddleware(loader: HostDataContextLoader) {
    return async function hostDataContextMiddleware(
        ctx: HonoContext,
        next: Next,
    ) {
        const host = ctx.req.header('host');
        const logger = ctx.get('logger');

        if (!host) {
            logger.info('No Host header');

            return new Response('No Host header', {
                status: 401,
            });
        }

        const result = await loader.loadDataForHost(host);

        if (isError(result)) {
            const error = getError(result);

            switch (error) {
                case 'site-not-found':
                    logger.info('No site found for {host}', { host });

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
                        host,
                    });

                    return new Response('No account found', {
                        status: 401,
                    });
                case 'multiple-users-for-site':
                    logger.error('Multiple users found for {host}', {
                        host,
                    });

                    return new Response('No account found', {
                        status: 401,
                    });
                default:
                    exhaustiveCheck(error);
            }
        }

        const { site, account } = getValue(result);

        ctx.set('site', site);
        ctx.set('account', account);

        await next();
    };
}
