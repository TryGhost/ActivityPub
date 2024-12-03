import { createHash } from 'node:crypto';
import {
    type Actor,
    Article,
    Create,
    Follow,
    Like,
    Mention,
    Note,
    PUBLIC_COLLECTION,
    type RequestContext,
    Undo,
    Update,
    isActor,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Context, Next } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { type ContextData, type HonoContextVariables, fedify } from './app';
import { ACTOR_DEFAULT_HANDLE } from './constants';
import {
    buildActivity,
    prepareNoteContent,
} from './helpers/activitypub/activity';
import { getSiteSettings } from './helpers/ghost';
import { toURL } from './helpers/uri';
import type { PersonData } from './helpers/user';
import { addToList, removeFromList } from './kv-helpers';
import { lookupActor, lookupObject } from './lookup-helpers';

import z from 'zod';

const PostSchema = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    html: z.string(),
    excerpt: z.string(),
    feature_image: z.string().url().nullable(),
    published_at: z.string().datetime(),
    url: z.string().url(),
});

type Post = z.infer<typeof PostSchema>;

async function postToArticle(
    ctx: RequestContext<ContextData>,
    post: Post,
    author: Actor | null,
) {
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
        attribution: author,
        name: post.title,
        content: post.html,
        image: toURL(post.feature_image),
        published: Temporal.Instant.from(post.published_at),
        preview: preview,
        url: toURL(post.url),
        to: PUBLIC_COLLECTION,
        cc: ctx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
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
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
        logger: ctx.get('logger'),
    });

    const objectToLike = await lookupObject(apCtx, id);
    if (!objectToLike) {
        return new Response(null, {
            status: 404,
        });
    }

    const likeId = apCtx.getObjectUri(Like, {
        id: createHash('sha256').update(objectToLike.id!.href).digest('hex'),
    });

    const undoId = apCtx.getObjectUri(Undo, {
        id: createHash('sha256').update(likeId.href).digest('hex'),
    });

    const likeToUndoJson = await ctx.get('globaldb').get([likeId.href]);
    if (!likeToUndoJson) {
        return new Response(null, {
            status: 409,
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
        attributionActor = await lookupActor(
            apCtx,
            objectToLike.attributionId.href,
        );
    }
    if (attributionActor) {
        apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
            attributionActor,
            undo,
            {
                preferSharedInbox: true,
            },
        );
    }

    apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, 'followers', undo, {
        preferSharedInbox: true,
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
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
        logger: ctx.get('logger'),
    });

    const objectToLike = await lookupObject(apCtx, id);
    if (!objectToLike) {
        return new Response(null, {
            status: 404,
        });
    }

    const likeId = apCtx.getObjectUri(Like, {
        id: createHash('sha256').update(objectToLike.id!.href).digest('hex'),
    });

    if (await ctx.get('globaldb').get([likeId.href])) {
        return new Response(null, {
            status: 409,
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
        attributionActor = await lookupActor(
            apCtx,
            objectToLike.attributionId.href,
        );
    }
    if (attributionActor) {
        apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
            attributionActor,
            like,
            {
                preferSharedInbox: true,
            },
        );
    }

    apCtx.sendActivity({ handle: ACTOR_DEFAULT_HANDLE }, 'followers', like, {
        preferSharedInbox: true,
    });
    return new Response(JSON.stringify(likeJson), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

const NoteActionSchema = z.object({
    content: z.string(),
});

export async function noteAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const logger = ctx.get('logger');

    let data: z.infer<typeof NoteActionSchema>;

    try {
        data = NoteActionSchema.parse((await ctx.req.json()) as unknown);
    } catch (err) {
        return new Response(JSON.stringify(err), { status: 400 });
    }

    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
        logger,
    });

    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE);

    const to = PUBLIC_COLLECTION;
    const cc = [apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE)];

    const noteId = apCtx.getObjectUri(Note, {
        id: uuidv4(),
    });

    const note = new Note({
        id: noteId,
        attribution: actor,
        content: prepareNoteContent(data.content),
        summary: null,
        published: Temporal.Now.instant(),
        to: to,
        ccs: cc,
    });

    const createId = apCtx.getObjectUri(Create, {
        id: uuidv4(),
    });

    const create = new Create({
        id: createId,
        actor: actor,
        object: note,
        to: to,
        ccs: cc,
    });

    const activityJson = await create.toJsonLd();

    await ctx.get('globaldb').set([create.id!.href], activityJson);
    await ctx.get('globaldb').set([note.id!.href], await note.toJsonLd());

    await addToList(ctx.get('db'), ['outbox'], create.id!.href);

    await apCtx.sendActivity(
        { handle: ACTOR_DEFAULT_HANDLE },
        'followers',
        create,
        {
            preferSharedInbox: true,
        },
    );

    return new Response(JSON.stringify(activityJson), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

const ReplyActionSchema = z.object({
    content: z.string(),
});

export async function replyAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const logger = ctx.get('logger');
    const id = ctx.req.param('id');

    const data = ReplyActionSchema.parse((await ctx.req.json()) as unknown);

    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
        logger,
    });

    const objectToReplyTo = await lookupObject(apCtx, id);
    if (!objectToReplyTo) {
        return new Response(null, {
            status: 404,
        });
    }

    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE);

    let attributionActor: Actor | null = null;
    if (objectToReplyTo.attributionId) {
        attributionActor = await lookupActor(
            apCtx,
            objectToReplyTo.attributionId.href,
        );
    }

    if (!attributionActor) {
        return new Response(null, {
            status: 400,
        });
    }

    const to = PUBLIC_COLLECTION;
    const cc = [attributionActor, apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE)];

    const conversation = objectToReplyTo.replyTargetId || objectToReplyTo.id!;
    const mentions = [
        new Mention({
            href: attributionActor.id,
            name: attributionActor.name,
        }),
    ];

    const replyId = apCtx.getObjectUri(Note, {
        id: uuidv4(),
    });

    const reply = new Note({
        id: replyId,
        attribution: actor,
        replyTarget: objectToReplyTo,
        content: data.content,
        summary: null,
        published: Temporal.Now.instant(),
        contexts: [conversation],
        tags: mentions,
        to: to,
        ccs: cc,
    });

    const createId = apCtx.getObjectUri(Create, {
        id: uuidv4(),
    });

    const create = new Create({
        id: createId,
        actor: actor,
        object: reply,
        to: to,
        ccs: cc,
    });

    const activityJson = await create.toJsonLd();

    await ctx.get('globaldb').set([create.id!.href], activityJson);
    await ctx.get('globaldb').set([reply.id!.href], await reply.toJsonLd());

    await addToList(ctx.get('db'), ['outbox'], create.id!.href);

    apCtx.sendActivity(
        { handle: ACTOR_DEFAULT_HANDLE },
        attributionActor,
        create,
        {
            preferSharedInbox: true,
        },
    );

    try {
        await apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
            'followers',
            create,
            {
                preferSharedInbox: true,
            },
        );
    } catch (err) {
        logger.error('Error sending reply activity - {error}', {
            error: err,
        });
    }

    return new Response(JSON.stringify(activityJson), {
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
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
        logger: ctx.get('logger'),
    });
    const actorToFollow = await lookupObject(apCtx, handle);
    if (!isActor(actorToFollow)) {
        // Not Found?
        return new Response(null, {
            status: 404,
        });
    }

    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

    if (actorToFollow.id!.href === actor!.id!.href) {
        return new Response(null, {
            status: 400,
        });
    }

    const following = (await ctx.get('db').get<string[]>(['following'])) || [];
    if (following.includes(actorToFollow.id!.href)) {
        return new Response(null, {
            status: 409,
        });
    }

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

    await apCtx.sendActivity(
        { handle: ACTOR_DEFAULT_HANDLE },
        actorToFollow,
        follow,
    );
    // We return the actor because the serialisation of the object property is not working as expected
    return new Response(JSON.stringify(await actorToFollow.toJsonLd()), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

const PostPublishedWebhookSchema = z.object({
    post: z.object({
        current: PostSchema,
    }),
});

export async function postPublishedWebhook(
    ctx: Context<{ Variables: HonoContextVariables }>,
    next: Next,
) {
    const data = PostPublishedWebhookSchema.parse(
        (await ctx.req.json()) as unknown,
    );
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
        logger: ctx.get('logger'),
    });
    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE);
    const { article, preview } = await postToArticle(
        apCtx,
        data.post.current,
        actor,
    );
    if (article) {
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
            await apCtx.sendActivity(
                { handle: ACTOR_DEFAULT_HANDLE },
                'followers',
                create,
                {
                    preferSharedInbox: true,
                },
            );
        } catch (err) {
            ctx.get('logger').error('Post published webhook failed: {error}', {
                error: err,
            });
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
            ctx.get('logger').info('No site settings changed, nothing to do');

            return new Response(JSON.stringify({}), {
                headers: {
                    'Content-Type': 'application/activity+json',
                },
                status: 200,
            });
        }

        ctx.get('logger').info('Site settings changed, will notify followers');

        // Update the database if the site settings have changed
        const updated = {
            ...current,
            icon: settings.site.icon,
            name: settings.site.title,
            summary: settings.site.description,
        };

        await db.set(['handle', handle], updated);

        // Publish activity if the site settings have changed
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const actor = await apCtx.getActor(handle);

        const update = new Update({
            id: apCtx.getObjectUri(Update, { id: uuidv4() }),
            actor: actor?.id,
            to: PUBLIC_COLLECTION,
            object: actor?.id,
            cc: apCtx.getFollowersUri('index'),
        });

        await ctx
            .get('globaldb')
            .set([update.id!.href], await update.toJsonLd());
        await apCtx.sendActivity({ handle }, 'followers', update, {
            preferSharedInbox: true,
        });
    } catch (err) {
        ctx.get('logger').error('Site changed webhook failed: {error}', {
            error: err,
        });
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
) {
    const db = ctx.get('db');
    const globaldb = ctx.get('globaldb');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb,
        logger,
    });

    // Fetch the liked items from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    // This is used to add a "liked" property to the item if the user has liked it
    const liked = (await db.get<string[]>(['liked'])) || [];

    // Fetch the inbox from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    const inbox = (await db.get<string[]>(['inbox'])) || [];

    // Prepare the items for the response
    const items = await Promise.all(
        inbox.map(async (item) => {
            try {
                return await buildActivity(item, globaldb, apCtx, liked);
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
