import type { Context } from 'hono';

import { type HonoContextVariables, fedify } from './app';
import { buildActivity } from './helpers/activitypub/activity';
import type { SiteService } from './site/site.service';

export const getSiteDataHandler =
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

export async function inboxHandler(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const globaldb = ctx.get('globaldb');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb,
        logger,
    });

    // Fetch the reposted items from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    // This is used to add a "reposted" property to the item if the user has reposted it
    const reposted = (await db.get<string[]>(['reposted'])) || [];

    // Fetch the inbox from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    const inbox = (await db.get<string[]>(['inbox'])) || [];

    // Prepare the items for the response
    const items = await Promise.all(
        inbox.map(async (item) => {
            try {
                return await buildActivity(
                    item,
                    globaldb,
                    apCtx,
                    [],
                    reposted,
                    [],
                    {
                        expandInReplyTo: false,
                        showReplyCount: true,
                        showRepostCount: true,
                    },
                );
            } catch (err) {
                ctx.get('logger').error('Inbox handler failed: {error}', {
                    error: err,
                });
                return null;
            }
        }),
    ).then((results) => results.filter(Boolean));

    // Return the prepared inbox items
    return new Response(
        JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollection',
            totalItems: inbox.length,
            items,
        }),
        {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        },
    );
}
