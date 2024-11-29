import { type CollectionPage, isActor } from '@fedify/fedify';
import type { Context } from 'hono';

import { sanitizeHtml } from 'helpers/sanitize';
import { type HonoContextVariables, fedify } from '../../../app';
import { isHandle } from '../../../helpers/activitypub/actor';
import { isUri } from '../../../helpers/uri';
import { lookupObject } from '../../../lookup-helpers';

interface ProfilePosts {
    posts: any[];
    next: string | null;
}

export async function profileGetPostsAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb: ctx.get('globaldb'),
        logger,
    });

    // Parse "handle" from request parameters
    // /profile/:handle/posts
    const handle = ctx.req.param('handle') || '';

    // If the provided handle is invalid, return early
    if (!isHandle(handle)) {
        return new Response(null, { status: 400 });
    }

    // Parse "next" from query parameters
    // /profile/:handle/posts?next=<string>
    const queryNext = ctx.req.query('next') || '';
    const next = queryNext ? decodeURIComponent(queryNext) : '';

    // If the next parameter is not a valid URI, return early
    if (next !== '' && !isUri(next)) {
        return new Response(null, { status: 400 });
    }

    // Lookup actor by handle
    const actor = await lookupObject(apCtx, handle);

    if (!isActor(actor)) {
        return new Response(null, { status: 404 });
    }

    // Retrieve actor's posts
    // If a next parameter was provided, use it to retrieve a specific page of
    // posts. Otherwise, retrieve the first page of posts
    const result: ProfilePosts = {
        posts: [],
        next: null,
    };

    let page: CollectionPage | null = null;

    try {
        if (next !== '') {
            // Ensure the next parameter is for the same host as the actor. We
            // do this to prevent blindly passing URIs to lookupObject (i.e next
            // param has been tampered with)
            // @TODO: Does this provide enough security? Can the host of the
            // actor be different to the host of the actor's followers collection?
            const { host: actorHost } = actor?.id || new URL('');
            const { host: nextHost } = new URL(next);

            if (actorHost !== nextHost) {
                return new Response(null, { status: 400 });
            }

            page = (await lookupObject(apCtx, next)) as CollectionPage | null;

            // Explicitly check that we have a valid page seeming though we
            // can't be type safe due to lookupObject returning a generic object
            if (!page?.itemIds) {
                page = null;
            }
        } else {
            const outbox = await actor.getOutbox();

            if (outbox) {
                page = await outbox.getFirst();
            }
        }
    } catch (err) {
        logger.error('Error getting outbox', { error: err });
    }

    if (!page) {
        return new Response(null, { status: 404 });
    }

    // Return result
    try {
        for await (const item of page.getItems()) {
            const activity = (await item.toJsonLd({
                format: 'compact',
            })) as any;

            if (activity?.object?.content) {
                activity.object.content = sanitizeHtml(activity.object.content);
            }

            if (typeof activity.actor === 'string') {
                activity.actor = await actor.toJsonLd({ format: 'compact' });
            }

            result.posts.push(activity);
        }
    } catch (err) {
        logger.error('Error getting posts', { error: err });
    }

    result.next = page.nextId
        ? encodeURIComponent(page.nextId.toString())
        : null;

    return new Response(JSON.stringify(result), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
