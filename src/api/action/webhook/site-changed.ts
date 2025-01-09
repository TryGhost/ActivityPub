import type { Context } from 'hono';

import { type HonoContextVariables, fedify } from '../../../app';
import { updateSiteActor } from '../../../helpers/activitypub/actor';
import { getSiteSettings } from '../../../helpers/ghost';

export async function webhookSiteChangedAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    try {
        const host = ctx.req.header('host') || '';
        const db = ctx.get('db');
        const globaldb = ctx.get('globaldb');
        const logger = ctx.get('logger');

        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb,
            logger,
        });

        await updateSiteActor(apCtx, getSiteSettings);
    } catch (err) {
        ctx.get('logger').error('Site changed webhook failed: {error}', {
            error: err,
        });
    }

    return new Response(JSON.stringify({}), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}
