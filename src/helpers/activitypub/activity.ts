import { createHash } from 'node:crypto';
import {
    type Context,
    type KvStore,
    Like,
} from '@fedify/fedify';

import type { ContextData } from '../../app';
import { getActivityReplyCount } from '../../db';
import { sanitizeHtml } from '../../helpers/sanitize';
import { lookupActor } from '../../lookup-helpers';

type Activity = {
    id: string;
    object: string | {
        id: string;
        content: string;
        [key: string]: any;
    };
    [key: string]: any;
}

export async function buildActivity(
    uri: string,
    db: KvStore,
    apCtx: Context<ContextData>,
    liked: string[] = [],
    expandInReplyTo = false,
): Promise<Activity | null> {
    const item = await db.get<Activity>([uri]);

    // If the item is not in the db, return null as we can't build it
    if (!item) {
        return null;
    }

    // If the object associated with the item is a string, it's probably a URI,
    // so we should look it up in the db. If it's not in the db, we should just
    // leave it as is
    if (typeof item.object === 'string') {
        item.object = await db.get([item.object]) ?? item.object;
    }

    // If the actor associated with the item is a string, it's probably a URI,
    // so we should look it up
    if (typeof item.actor === 'string') {
        const actor = await lookupActor(apCtx, item.actor);

        if (actor) {
            const json = await actor.toJsonLd();

            if (typeof json === 'object' && json !== null) {
                item.actor = json;
            }
        }
    }

    // If the object associated with the item is an object with an attributedTo
    // property, it's probably a URI, so we should look it up
    if (typeof item.object !== 'string' && typeof item.object.attributedTo === 'string') {
        const actor = await lookupActor(apCtx, item.object.attributedTo);

        if (actor) {
            const json = await actor.toJsonLd();

            if (typeof json === 'object' && json !== null) {
                item.object.attributedTo = json;
            }
        }
    }

    // If the object associated with the item is an object with a content property,
    // we should sanitize the content to prevent XSS (in case it contains HTML)
    if (item.object && typeof item.object !== 'string' && item.object.content) {
        item.object.content = sanitizeHtml(item.object.content);
    }

    // If the associated object is a Like, we should check if it's in the provided
    // liked list and add a liked property to the item if it is
    let objectId = '';

    if (typeof item.object === 'string') {
        objectId = item.object;
    } else if (typeof item.object.id === 'string') {
        objectId = item.object.id;
    }

    if (objectId) {
        const likeId = apCtx.getObjectUri(Like, {
            id: createHash('sha256').update(objectId).digest('hex'),
        });
        if (liked.includes(likeId.href)) {
            if (typeof item.object !== 'string') {
                item.object.liked = true;
            }
        }
    }

    // Expand the inReplyTo object if it is a string and we are expanding inReplyTo
    if (expandInReplyTo && typeof item.object !== 'string' && item.object.inReplyTo) {
        const replyObject = await db.get([item.object.inReplyTo]);

        if (replyObject) {
            item.object.inReplyTo = replyObject;
        }
    }

    // Add the reply count to the object, if it is an object
    if (typeof item.object !== 'string') {
        item.object.replyCount = await getActivityReplyCount(item.object.id);
    }

    // Return the built item
    return item;
}
