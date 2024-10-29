import { createHash } from 'node:crypto';
import {
    Context,
    KvStore,
    Like,
} from '@fedify/fedify';

import { ContextData } from '../../app';
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
    repliesMap: Map<string, any> | null = null,
    expandInReplyTo: boolean = false,
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

    if (typeof item.actor === 'string') {
        const actor = await lookupActor(apCtx, item.actor);

        if (actor) {
            const json = await actor.toJsonLd();
            if (typeof json === 'object' && json !== null) {
                item.actor = json;
            }
        }
    }

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
    let objectId: string = '';

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

    // If a replies map has been provided, the item is not a string, and the
    // item has an id, we should nest any replies recursively (which involves
    // calling this function again for each reply)
    if (repliesMap && typeof item.object !== 'string' && item.object.id) {
        item.object.replies = [];

        const replies = repliesMap.get(item.object.id);

        if (replies) {
            const builtReplies = [];

            for (const reply of replies) {
                const builtReply = await buildActivity(reply.id, db, apCtx, liked, repliesMap);

                if (builtReply) {
                    builtReplies.push(builtReply);
                }
            }

            item.object.replies = builtReplies;
        }
    }

    // Expand the inReplyTo object if it is a string and we are expanding inReplyTo
    if (expandInReplyTo && typeof item.object !== 'string' && item.object.inReplyTo) {
        const replyObject = await db.get([item.object.inReplyTo]);

        if (replyObject) {
            item.object.inReplyTo = replyObject;
        }
    }

    // Return the built item
    return item;
}
