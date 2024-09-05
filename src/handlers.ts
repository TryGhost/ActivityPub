import {
    Article,
    Follow,
    Like,
    Undo,
    RequestContext,
    lookupObject,
    isActor,
    Create,
    Note,
    Update,
    Actor,
    PUBLIC_COLLECTION
} from '@fedify/fedify';
import { Context, Next } from 'hono';
import sanitizeHtml from 'sanitize-html';
import { v4 as uuidv4 } from 'uuid';
import { addToList, removeFromList } from './kv-helpers';
import { toURL } from './toURL';
import { ContextData, HonoContextVariables, fedify } from './app';
import { getSiteSettings } from './ghost';
import type { PersonData } from './user';
import { ACTOR_DEFAULT_HANDLE } from './constants';
import { Temporal } from '@js-temporal/polyfill';
import { createHash } from 'node:crypto';
import { lookupActor } from 'lookup-helpers';

type StoredThing = {
    id: string;
    object: string | {
        id: string;
        content: string;
        [key: string]: any;
    };
    [key: string]: any;
}

import z from 'zod';

const PostSchema = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    html: z.string(),
    excerpt: z.string(),
    feature_image: z.string().url().nullable(),
    published_at: z.string().datetime(),
    url: z.string().url()
});

type Post = z.infer<typeof PostSchema>

async function postToArticle(ctx: RequestContext<ContextData>, post: Post) {
    if (!post) {
        return {
            article: null,
            preview: null,
        };
    }
    const preview = new Note({
        id: ctx.getObjectUri(Note, { id: post.uuid }),
        content: post.excerpt,
    });
    const article = new Article({
        id: ctx.getObjectUri(Article, { id: post.uuid }),
        name: post.title,
        content: post.html,
        image: toURL(post.feature_image),
        published: Temporal.Instant.from(post.published_at),
        preview: preview,
        url: toURL(post.url),
    });

    return {
        article,
        preview,
    };
}

export async function unlikeAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const id = ctx.req.param('id');
    const objectToLike = await lookupObject(id);
    if (!objectToLike) {
        return new Response(null, {
            status: 404
        });
    }
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
    });

    const likeId = apCtx.getObjectUri(Like, {
        id: createHash('sha256').update(objectToLike.id!.href).digest('hex'),
    });

    const undoId = apCtx.getObjectUri(Undo, {
        id: createHash('sha256').update(likeId.href).digest('hex'),
    });

    const likeToUndoJson = await ctx.get('globaldb').get([likeId.href]);
    if (!likeToUndoJson) {
        return new Response(null, {
            status: 409
        });
    }

    const likeToUndo = await Like.fromJsonLd(likeToUndoJson);

    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

    const undo = new Undo({
        id: undoId,
        actor: actor,
        object: likeToUndo,
        to: PUBLIC_COLLECTION,
        cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
    });
    const undoJson = await undo.toJsonLd();
    await ctx.get('globaldb').set([undo.id!.href], undoJson);

    await removeFromList(ctx.get('db'), ['liked'], likeId!.href);
    await ctx.get('globaldb').delete([likeId!.href]);

    let attributionActor: Actor | null = null;
    if (objectToLike.attributionId) {
        attributionActor = await lookupActor(apCtx, objectToLike.attributionId.href);
    }
    if (attributionActor) {
        apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, attributionActor, undo, {
            preferSharedInbox: true
        });
    }

    apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, 'followers', undo, {
        preferSharedInbox: true
    });
    return new Response(JSON.stringify(undoJson), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

export async function likeAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const id = ctx.req.param('id');
    const objectToLike = await lookupObject(id);
    if (!objectToLike) {
        return new Response(null, {
            status: 404
        });
    }
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
    });

    const likeId = apCtx.getObjectUri(Like, {
        id: createHash('sha256').update(objectToLike.id!.href).digest('hex'),
    });

    if (await ctx.get('globaldb').get([likeId.href])) {
        return new Response(null, {
            status: 409
        });
    }

    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

    const like = new Like({
        id: likeId,
        actor: actor,
        object: objectToLike,
        to: PUBLIC_COLLECTION,
        cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
    });
    const likeJson = await like.toJsonLd();
    await ctx.get('globaldb').set([like.id!.href], likeJson);

    await addToList(ctx.get('db'), ['liked'], like.id!.href);

    let attributionActor: Actor | null = null;
    if (objectToLike.attributionId) {
        attributionActor = await lookupActor(apCtx, objectToLike.attributionId.href);
    }
    if (attributionActor) {
        apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, attributionActor, like, {
            preferSharedInbox: true
        });
    }

    apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, 'followers', like, {
        preferSharedInbox: true
    });
    return new Response(JSON.stringify(likeJson), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

export async function followAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const handle = ctx.req.param('handle');
    const actorToFollow = await lookupObject(handle);
    if (!isActor(actorToFollow)) {
        // Not Found?
        return;
    }
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
    });
    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request
    const followId = apCtx.getObjectUri(Follow, {
        id: uuidv4(),
    });
    const follow = new Follow({
        id: followId,
        actor: actor,
        object: actorToFollow,
    });
    const followJson = await follow.toJsonLd();
    ctx.get('globaldb').set([follow.id!.href], followJson);

    apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, actorToFollow, follow);
    return new Response(JSON.stringify(followJson), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

const PostPublishedWebhookSchema = z.object({
    post: z.object({
        current: PostSchema
    })
});

export async function postPublishedWebhook(
    ctx: Context<{ Variables: HonoContextVariables }>,
    next: Next,
) {
    // TODO: Validate webhook with secret
    const data = PostPublishedWebhookSchema.parse(
        await ctx.req.json() as unknown
    );
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
    });
    const { article, preview } = await postToArticle(
        apCtx,
        data.post.current,
    );
    if (article) {
        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE);
        const create = new Create({
            actor,
            object: article,
            id: apCtx.getObjectUri(Create, { id: uuidv4() }),
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri('index'),
        });
        try {
            await article.toJsonLd();
            await ctx
                .get('globaldb')
                .set([preview.id!.href], await preview.toJsonLd());
            await ctx
                .get('globaldb')
                .set([create.id!.href], await create.toJsonLd());
            await ctx
                .get('globaldb')
                .set([article.id!.href], await article.toJsonLd());
            await addToList(ctx.get('db'), ['outbox'], create.id!.href);
            await apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, 'followers', create, {
                preferSharedInbox: true
            });
        } catch (err) {
            console.log(err);
        }
    }
    return new Response(JSON.stringify({}), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

export async function siteChangedWebhook(
    ctx: Context<{ Variables: HonoContextVariables }>,
    next: Next,
) {
    try {
        // Retrieve site settings from Ghost
        const host = ctx.req.header('host') || '';

        const settings = await getSiteSettings(host);

        // Retrieve the persisted actor details and check if anything has changed
        const handle = ACTOR_DEFAULT_HANDLE;
        const db = ctx.get('db');

        const current = await db.get<PersonData>(['handle', handle]);

        if (
            current &&
            current.icon === settings.site.icon &&
            current.name === settings.site.title &&
            current.summary === settings.site.description
        ) {
            console.log('No site settings changed, nothing to do');

            return new Response(JSON.stringify({}), {
                headers: {
                    'Content-Type': 'application/activity+json',
                },
                status: 200,
            });
        }

        console.log('Site settings changed, will notify followers');

        // Update the database if the site settings have changed
        const updated =  {
            ...current,
            icon: settings.site.icon,
            name: settings.site.title,
            summary: settings.site.description,
        }

        await db.set(['handle', handle], updated);

        // Publish activity if the site settings have changed
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
        });

        const actor = await apCtx.getActor(handle);

        const update = new Update({
            id: apCtx.getObjectUri(Update, { id: uuidv4() }),
            actor: actor?.id,
            to: PUBLIC_COLLECTION,
            object: actor?.id,
            cc: apCtx.getFollowersUri('index'),
        });

        await ctx.get('globaldb').set([update.id!.href], await update.toJsonLd());
        await addToList(db, ['outbox'], update.id!.href);
        await apCtx.sendActivity({ handle }, 'followers', update, {
            preferSharedInbox: true
        });
    } catch (err) {
        console.log(err);
    }

    // Return 200 OK
    return new Response(JSON.stringify({}), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

export async function inboxHandler(
    ctx: Context<{ Variables: HonoContextVariables }>,
    next: Next,
) {
    const liked = (await ctx.get('db').get<string[]>(['liked'])) || [];
    const results = (await ctx.get('db').get<string[]>(['inbox'])) || [];
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
    });
    let items: unknown[] = [];
    for (const result of results) {
        try {
            const db = ctx.get('globaldb');
            const thing = await db.get<StoredThing>([result]);
            if (!thing) {
                continue;
            }

            // If the object is a string, it's probably a URI, so we should
            // look it up the db. If it's not in the db, we should just leave
            // it as is
            if (typeof thing.object === 'string') {
                thing.object = await db.get([thing.object]) ?? thing.object;
            }

            // Sanitize HTML content
            if (thing.object && typeof thing.object !== 'string') {
                thing.object.content = sanitizeHtml(thing.object.content, {
                    allowedTags: ['a', 'p', 'img', 'br', 'strong', 'em', 'span'],
                    allowedAttributes: {
                        a: ['href'],
                        img: ['src'],
                    }
                });
            }

            let objectId: string = '';
            if (typeof thing.object === 'string') {
                objectId = thing.object;
            } else if (typeof thing.object.id === 'string') {
                objectId = thing.object.id;
            }

            if (objectId) {
                const likeId = apCtx.getObjectUri(Like, {
                    id: createHash('sha256').update(objectId).digest('hex'),
                });
                if (liked.includes(likeId.href)) {
                    if (typeof thing.object !== 'string') {
                        thing.object.liked = true;
                    }
                }
            }

            items.push(thing);
        } catch (err) {
            console.log(err);
        }
    }
    return new Response(
        JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollection',
            totalItems: results.length,
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
