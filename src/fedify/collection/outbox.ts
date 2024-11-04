import { Activity, type RequestContext } from '@fedify/fedify';
import * as Sentry from '@sentry/node';
import type { ContextData } from '../../app';
import { OUTBOX_PAGE_SIZE } from '../../constants';

function filterOutboxActivityUris(activityUris: string[]) {
    // Only return Create and Announce activityUris
    return activityUris.filter((uri) => /(create|announce)/.test(uri));
}

export async function outboxDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
    cursor: string | null,
) {
    ctx.data.logger.info('Outbox Dispatcher');

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    const results = filterOutboxActivityUris(
        (await ctx.data.db.get<string[]>(['outbox'])) || [],
    ).reverse();

    nextCursor =
        results.length > offset + OUTBOX_PAGE_SIZE
            ? (offset + OUTBOX_PAGE_SIZE).toString()
            : null;

    const slicedResults = results.slice(offset, offset + OUTBOX_PAGE_SIZE);

    ctx.data.logger.info('Outbox results', { results: slicedResults });

    const items: Activity[] = [];

    for (const result of slicedResults) {
        try {
            const thing = await ctx.data.globaldb.get([result]);
            const activity = await Activity.fromJsonLd(thing);

            items.push(activity);
        } catch (err) {
            Sentry.captureException(err);
            ctx.data.logger.error('Error getting outbox activity', {
                error: err,
            });
        }
    }

    return {
        items,
        nextCursor,
    };
}

export async function outboxCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['outbox'])) || [];

    return filterOutboxActivityUris(results).length;
}

export function outboxFirstCursor() {
    return '0';
}
