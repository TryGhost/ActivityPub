import { createHash } from 'node:crypto';
import {
    type Actor,
    Create,
    Follow,
    Like,
    Mention,
    Note,
    PUBLIC_COLLECTION,
    Undo,
    isActor,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import z from 'zod';

import type { AccountService } from './account/account.service';
import { mapActorToExternalAccountData } from './account/utils';
import { type HonoContextVariables, fedify } from './app';
import { ACTOR_DEFAULT_HANDLE } from './constants';
import { buildActivity } from './helpers/activitypub/activity';
import { updateSiteActor } from './helpers/activitypub/actor';
import { getSiteSettings } from './helpers/ghost';
import { escapeHtml } from './helpers/html';
import { getUserData } from './helpers/user';
import { addToList, removeFromList } from './kv-helpers';
import { lookupActor, lookupObject } from './lookup-helpers';
import type { SiteService } from './site/site.service';

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

const ReplyActionSchema = z.object({
    content: z.string(),
});

export async function replyAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const logger = ctx.get('logger');
    const id = ctx.req.param('id');

    let data: z.infer<typeof ReplyActionSchema>;

    try {
        data = ReplyActionSchema.parse((await ctx.req.json()) as unknown);

        data.content = escapeHtml(data.content);
    } catch (err) {
        return new Response(JSON.stringify(err), { status: 400 });
    }

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

export function createFollowActionHandler(accountService: AccountService) {
    return async function followAction(
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

        const followerAccount = await accountService.getAccountByApId(
            actor!.id!.href,
        );

        if (!followerAccount) {
            return new Response(null, {
                status: 404,
            });
        }

        let followeeAccount = await accountService.getAccountByApId(
            actorToFollow.id!.href,
        );
        if (!followeeAccount) {
            followeeAccount = await accountService.createExternalAccount(
                await mapActorToExternalAccountData(actorToFollow),
            );
        }

        if (
            await accountService.checkIfAccountIsFollowing(
                followerAccount,
                followeeAccount,
            )
        ) {
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
    };
}

export const getSiteDataHandler =
    (siteService: SiteService) =>
    async (ctx: Context<{ Variables: HonoContextVariables }>) => {
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            ctx.get('logger').info('No Host header');
            return new Response('No Host header', {
                status: 401,
            });
        }

        const handle = ACTOR_DEFAULT_HANDLE;
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const site = await siteService.initialiseSiteForHost(host);

        console.log(site);

        // This is to ensure that the actor exists - e.g. for a brand new a site
        await getUserData(apCtx, handle);

        await updateSiteActor(apCtx, getSiteSettings);

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
