import {
    Object as APObject,
    Accept,
    Activity,
    type Actor,
    type Announce,
    Article,
    type Context,
    Create,
    Follow,
    Like,
    Note,
    Person,
    type Protocol,
    type Recipient,
    type RequestContext,
    Undo,
    Update,
    isActor,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';
import { type ContextData, fedify } from './app';
import {
    ACTOR_DEFAULT_HANDLE,
    FOLLOWERS_PAGE_SIZE,
    FOLLOWING_PAGE_SIZE,
    LIKED_PAGE_SIZE,
    OUTBOX_PAGE_SIZE,
} from './constants';
import { getUserData, getUserKeypair } from './helpers/user';
import { addToList } from './kv-helpers';
import { lookupActor, lookupObject } from './lookup-helpers';

export async function actorDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    if (handle !== ACTOR_DEFAULT_HANDLE) return null;

    const data = await getUserData(ctx, handle);

    const person = new Person(data);

    return person;
}

export async function keypairDispatcher(ctx: Context<ContextData>, handle: string) {
    if (handle !== ACTOR_DEFAULT_HANDLE) return [];

    const data = await getUserKeypair(ctx, handle);

    if (!data) return [];

    return [data];
}

export async function handleFollow(
    ctx: Context<ContextData>,
    follow: Follow,
) {
    ctx.data.logger.info('Handling Follow');
    if (!follow.id) {
        return;
    }
    const parsed = ctx.parseUri(follow.objectId);
    if (parsed?.type !== 'actor') {
        // TODO Log
        return;
    }
    const sender = await follow.getActor(ctx);
    if (sender === null || sender.id === null) {
        return;
    }

    const currentFollowers = await ctx.data.db.get<string[]>(['followers']) ?? [];
    const shouldRecordFollower = currentFollowers.includes(sender.id.href) === false;

    // Add follow activity to inbox
    const followJson = await follow.toJsonLd();

    ctx.data.globaldb.set([follow.id.href], followJson);
    await addToList(ctx.data.db, ['inbox'], follow.id.href);

    // Record follower in followers list
    const senderJson = await sender.toJsonLd();

    if (shouldRecordFollower) {
        await addToList(ctx.data.db, ['followers'], sender.id.href);
        await addToList(ctx.data.db, ['followers', 'expanded'], senderJson);
    }

    // Store or update sender in global db
    ctx.data.globaldb.set([sender.id.href], senderJson);

    // Send accept activity to sender
    const acceptId = ctx.getObjectUri(Accept, { id: uuidv4() });
    const accept = new Accept({
        id: acceptId,
        actor: follow.objectId,
        object: follow,
    });
    const acceptJson = await accept.toJsonLd();

    await ctx.data.globaldb.set([accept.id!.href], acceptJson);

    await ctx.sendActivity({ handle: parsed.handle }, sender, accept);
}

export async function handleAccept(
    ctx: Context<ContextData>,
    accept: Accept,
) {
    ctx.data.logger.info('Handling Accept');
    const parsed = (ctx as any).parseUri(accept.objectId);
    ctx.data.logger.info('Parsed accept object', { parsed });
    // biome-ignore lint/correctness/noConstantCondition: present when adding linting
    if (false && parsed?.type !== 'follow') {
        ctx.data.logger.info('Not accepting a follow - exit');
        return;
    }
    if (!accept.id) {
        ctx.data.logger.info('Accept missing id - exit');
        return;
    }

    const sender = await accept.getActor(ctx);
    ctx.data.logger.info('Accept sender', { sender });
    if (sender === null || sender.id === null) {
        ctx.data.logger.info('Sender missing, exit early');
        return;
    }

    const senderJson = await sender.toJsonLd();
    const acceptJson = await accept.toJsonLd();
    ctx.data.globaldb.set([accept.id.href], acceptJson);
    ctx.data.globaldb.set([sender.id.href], senderJson);
    await addToList(ctx.data.db, ['inbox'], accept.id.href);
    await addToList(ctx.data.db, ['following'], sender.id.href);
}

export async function handleCreate(
    ctx: Context<ContextData>,
    create: Create,
) {
    ctx.data.logger.info('Handling Create');
    const parsed = (ctx as any).parseUri(create.objectId);
    ctx.data.logger.info('Parsed create object', { parsed });
    // biome-ignore lint/correctness/noConstantCondition: present when adding linting
    if (false && parsed?.type !== 'article') {
        ctx.data.logger.info('Not accepting a follow - exit');
        return;
    }
    if (!create.id) {
        ctx.data.logger.info('Create missing id - exit');
        return;
    }

    const sender = await create.getActor(ctx);
    if (sender === null || sender.id === null) {
        ctx.data.logger.info('Create sender missing, exit early');
        return;
    }

    // TODO Check Sender is in our following
    const createJson = await create.toJsonLd();
    ctx.data.globaldb.set([create.id.href], createJson);
    await addToList(ctx.data.db, ['inbox'], create.id.href);
}

export async function handleAnnounce(
    ctx: Context<ContextData>,
    announce: Announce,
) {
    ctx.data.logger.info('Handling Announce');

    // Validate announce
    if (!announce.id) {
        ctx.data.logger.info('Invalid Announce - no id');
        return;
    }

    if (!announce.objectId) {
        ctx.data.logger.info('Invalid Announce - no object id');
        return;
    }

    // Validate sender
    const sender = await announce.getActor(ctx);

    if (sender === null || sender.id === null) {
        ctx.data.logger.info('Announce sender missing, exit early');
        return;
    }

    // Lookup announced object - If not found in globalDb, perform network lookup
    let object = null;
    const existing = await ctx.data.globaldb.get([announce.objectId.href]) ?? null;

    if (!existing) {
        ctx.data.logger.info('Announce object not found in globalDb, performing network lookup');
        object = await lookupObject(ctx, announce.objectId);
    }

    // Validate object
    if (!existing && !object) {
        ctx.data.logger.info('Invalid Announce - could not find object');
        return;
    }

    if (object && !object.id) {
        ctx.data.logger.info('Invalid Announce - could not find object id');
        return;
    }

    // Persist announce
    const announceJson = await announce.toJsonLd();
    ctx.data.globaldb.set([announce.id.href], announceJson);

    // Persist object if not already persisted
    if (!existing && object && object.id) {
        ctx.data.logger.info('Storing object in globalDb');

        const objectJson = await object.toJsonLd();

        if (typeof objectJson === 'object' && objectJson !== null) {
            if ('attributedTo' in objectJson && typeof objectJson.attributedTo === 'string') {
                const actor = await lookupActor(ctx, objectJson.attributedTo);
                objectJson.attributedTo = await actor?.toJsonLd();
            }
        }

        ctx.data.globaldb.set([object.id.href], objectJson);
    }

    // Add announce to inbox
    await addToList(ctx.data.db, ['inbox'], announce.id.href);
}

export async function handleLike(
    ctx: Context<ContextData>,
    like: Like,
) {
    ctx.data.logger.info('Handling Like');

    // Validate like
    if (!like.id) {
        ctx.data.logger.info('Invalid Like - no id');
        return;
    }

    if (!like.objectId) {
        ctx.data.logger.info('Invalid Like - no object id');
        return;
    }

    // Validate sender
    const sender = await like.getActor(ctx);

    if (sender === null || sender.id === null) {
        ctx.data.logger.info('Like sender missing, exit early');
        return;
    }

    // Lookup liked object - If not found in globalDb, perform network lookup
    let object = null;
    const existing = await ctx.data.globaldb.get([like.objectId.href]) ?? null;

    if (!existing) {
        ctx.data.logger.info('Like object not found in globalDb, performing network lookup');

        object = await like.getObject();
    }

    // Validate object
    if (!existing && !object) {
        ctx.data.logger.info('Invalid Like - could not find object');
        return;
    }

    if (object && !object.id) {
        ctx.data.logger.info('Invalid Like - could not find object id');
        return;
    }

    // Persist like
    const likeJson = await like.toJsonLd();
    ctx.data.globaldb.set([like.id.href], likeJson);

    // Persist object if not already persisted
    if (!existing && object && object.id) {
        ctx.data.logger.info('Storing object in globalDb');

        const objectJson = await object.toJsonLd();

        ctx.data.globaldb.set([object.id.href], objectJson);
    }

    // Add to inbox
    await addToList(ctx.data.db, ['inbox'], like.id.href);
}

export async function inboxErrorHandler(
    ctx: Context<ContextData>,
    error: unknown,
) {
    ctx.data.logger.error('Error handling incoming activity', { error });
}

export async function followersDispatcher(
    ctx: Context<ContextData>,
    handle: string,
    cursor: string | null,
) {
    ctx.data.logger.info('Followers Dispatcher');

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    let items: Recipient[] = [];

    const fullResults = (await ctx.data.db.get<any[]>(['followers', 'expanded']) ?? [])
        .filter((v, i, results) => {
            // Remove duplicates
            return results.findIndex((r) => r.id === v.id) === i;
        });

    if (fullResults) {
        nextCursor = fullResults.length > offset + FOLLOWERS_PAGE_SIZE
            ? (offset + FOLLOWERS_PAGE_SIZE).toString()
            : null;

        items = fullResults.slice(offset, offset + FOLLOWERS_PAGE_SIZE);
    } else {
        const results = [
            // Remove duplicates
            ...new Set(
                (await ctx.data.db.get<string[]>(['followers'])) || []
            )
        ];

        nextCursor = results.length > offset + FOLLOWERS_PAGE_SIZE
            ? (offset + FOLLOWERS_PAGE_SIZE).toString()
            : null;

        const slicedResults = results.slice(offset, offset + FOLLOWERS_PAGE_SIZE);

        const actors = (
            await Promise.all(
                slicedResults.map((result) => lookupActor(ctx, result))
            )
        // This could potentially mean that the slicedResults is not the size
        // of FOLLOWERS_PAGE_SIZE if for some reason the lookupActor returns
        // null for some of the results. TODO: Find a better way to handle this
        ).filter((item): item is Actor => isActor(item))

        const toStore = await Promise.all(
            actors.map(actor => actor.toJsonLd() as any)
        );

        await ctx.data.db.set(['followers', 'expanded'], toStore);

        items = toStore;
    }

    return {
        items: (
            await Promise.all(
                items.map(item => APObject.fromJsonLd(item))
            )
        ).filter((item): item is Actor => isActor(item)),
        nextCursor,
    };
}

export async function followersCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = [
        // Remove duplicates
        ...new Set(
            (await ctx.data.db.get<string[]>(['followers'])) || []
        )
    ];
    return results.length;
}

export function followersFirstCursor() {
    return '0';
}

export async function followingDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
    cursor: string | null,
) {
    ctx.data.logger.info('Following Dispatcher');

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    const results = (await ctx.data.db.get<string[]>(['following'])) || []

    nextCursor = results.length > offset + FOLLOWING_PAGE_SIZE
        ? (offset + FOLLOWING_PAGE_SIZE).toString()
        : null;

    const slicedResults = results.slice(offset, offset + FOLLOWING_PAGE_SIZE);

    ctx.data.logger.info('Following results', { results: slicedResults });

    const items: Actor[] = [];

    for (const result of slicedResults) {
        try {
            const thing = await lookupActor(ctx, result);

            if (isActor(thing)) {
                items.push(thing);
            }
        } catch (err) {
            ctx.data.logger.error('Error looking up following actor', { error: err });
        }
    }

    return {
        items,
        nextCursor,
    };
}

export async function followingCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['following'])) || [];
    return results.length;
}

export function followingFirstCursor() {
    return '0';
}

function filterOutboxActivityUris (activityUris: string[]) {
    // Only return Create and Announce activityUris
    return activityUris.filter(uri => /(create|announce)/.test(uri));
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
        (await ctx.data.db.get<string[]>(['outbox'])) || []
    ).reverse();

    nextCursor = results.length > offset + OUTBOX_PAGE_SIZE
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
            ctx.data.logger.error('Error getting outbox activity', { error: err });
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

export async function likedDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
    cursor: string | null,
) {
    ctx.data.logger.info('Liked Dispatcher');

    const db = ctx.data.db;
    const globaldb = ctx.data.globaldb;
    const logger = ctx.data.logger;
    const apCtx = fedify.createContext(ctx.request as Request, {
        db,
        globaldb,
        logger,
    });

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    const results = (
        (await db.get<string[]>(['liked'])) || []
    ).reverse();

    nextCursor = results.length > offset + LIKED_PAGE_SIZE
        ? (offset + LIKED_PAGE_SIZE).toString()
        : null;

    const slicedResults = results.slice(offset, offset + LIKED_PAGE_SIZE);

    ctx.data.logger.info('Liked results', { results: slicedResults });

    const items: Like[] = [];

    for (const result of slicedResults) {
        try {
            const thing = await globaldb.get<{
                object: string | {
                    [key: string]: any;
                };
                [key: string]: any;
            }>([result]);

            if (thing && typeof thing.object !== 'string' && typeof thing.object.attributedTo === 'string') {
                const actor = await lookupActor(apCtx, thing.object.attributedTo);

                if (actor) {
                    const json = await actor.toJsonLd();

                    if (typeof json === 'object' && json !== null) {
                        thing.object.attributedTo = json;
                    }
                }
            }

            const activity = await Like.fromJsonLd(thing);

            items.push(activity);
        } catch (err) {
            ctx.data.logger.error('Error getting liked activity', { error: err });
        }
    }

    return {
        items,
        nextCursor,
    };
}

export async function likedCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['liked'])) || [];

    return results.length;
}

export function likedFirstCursor() {
    return '0';
}

export async function articleDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Article, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Article.fromJsonLd(exists);
}

export async function followDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Follow, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Follow.fromJsonLd(exists);
}

export async function acceptDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Accept, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Accept.fromJsonLd(exists);
}

export async function createDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Create, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Create.fromJsonLd(exists);
}

export async function updateDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Update, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Update.fromJsonLd(exists);
}

export async function noteDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Note, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Note.fromJsonLd(exists);
}

export async function likeDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Like, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Like.fromJsonLd(exists);
}

export async function undoDispatcher(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Undo, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Undo.fromJsonLd(exists);
}

export async function nodeInfoDispatcher(
    ctx: RequestContext<ContextData>,
) {
    return {
        software: {
          name: 'ghost',
          version: { major: 0, minor: 0, patch: 0 },
          homepage: new URL("https://ghost.org/"),
          repository: new URL("https://github.com/TryGhost/Ghost"),
        },
        protocols: ['activitypub'] as Protocol[],
        openRegistrations: false,
        usage: {
          users: {},
          localPosts: 0,
          localComments: 0,
        },
    }
}
