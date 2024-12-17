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
    Group,
    Like,
    Note,
    Person,
    type Protocol,
    type Recipient,
    type RequestContext,
    Undo,
    Update,
    isActor,
    verifyObject,
} from '@fedify/fedify';
import * as Sentry from '@sentry/node';
import { v4 as uuidv4 } from 'uuid';
import { type ContextData, fedify } from './app';
import { ACTOR_DEFAULT_HANDLE } from './constants';
import { isFollowing } from './helpers/activitypub/actor';
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

export async function keypairDispatcher(
    ctx: Context<ContextData>,
    handle: string,
) {
    if (handle !== ACTOR_DEFAULT_HANDLE) return [];

    const data = await getUserKeypair(ctx, handle);

    if (!data) return [];

    return [data];
}

export async function handleFollow(ctx: Context<ContextData>, follow: Follow) {
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

    const currentFollowers =
        (await ctx.data.db.get<string[]>(['followers'])) ?? [];
    const shouldRecordFollower =
        currentFollowers.includes(sender.id.href) === false;

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

export async function handleAccept(ctx: Context<ContextData>, accept: Accept) {
    ctx.data.logger.info('Handling Accept');
    const parsed = ctx.parseUri(accept.objectId);
    ctx.data.logger.info('Parsed accept object', { parsed });
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

export async function handleCreate(ctx: Context<ContextData>, create: Create) {
    ctx.data.logger.info('Handling Create');
    const parsed = ctx.parseUri(create.objectId);
    ctx.data.logger.info('Parsed create object', { parsed });
    if (!create.id) {
        ctx.data.logger.info('Create missing id - exit');
        return;
    }

    const sender = await create.getActor(ctx);
    if (sender === null || sender.id === null) {
        ctx.data.logger.info('Create sender missing, exit early');
        return;
    }

    const createJson = await create.toJsonLd();
    ctx.data.globaldb.set([create.id.href], createJson);

    const object = await create.getObject();
    const replyTarget = await object?.getReplyTarget();

    if (replyTarget?.id?.href) {
        const data = await ctx.data.globaldb.get<any>([replyTarget.id.href]);
        const replyTargetAuthor = data?.attributedTo?.id;
        const inboxActor = await getUserData(ctx, 'index');

        if (replyTargetAuthor === inboxActor.id.href) {
            await addToList(ctx.data.db, ['inbox'], create.id.href);
            return;
        }
    }

    if (await isFollowing(sender, { db: ctx.data.db })) {
        await addToList(ctx.data.db, ['inbox'], create.id.href);
        return;
    }
}

export async function handleAnnoucedCreate(
    ctx: Context<ContextData>,
    announce: Announce,
) {
    ctx.data.logger.info('Handling Announced Create');

    // Validate announced create activity is from a Group as we only support
    // announcements from Groups - See https://codeberg.org/fediverse/fep/src/branch/main/fep/1b12/fep-1b12.md
    const announcer = await announce.getActor(ctx);

    if (!(announcer instanceof Group)) {
        ctx.data.logger.info('Create is not from a Group, exit early');

        return;
    }

    // Validate that the group is followed
    if (!(await isFollowing(announcer, { db: ctx.data.db }))) {
        ctx.data.logger.info('Group is not followed, exit early');

        return;
    }

    let create: Create | null = null;

    // Verify create activity
    create = (await announce.getObject()) as Create;

    if (!create.id) {
        ctx.data.logger.info('Create missing id, exit early');

        return;
    }

    if (create.proofId || create.proofIds.length > 0) {
        ctx.data.logger.info('Verifying create with proof(s)');

        if ((await verifyObject(Create, await create.toJsonLd())) === null) {
            ctx.data.logger.info(
                'Create cannot be verified with provided proof(s), exit early',
            );

            return;
        }
    } else {
        ctx.data.logger.info('Verifying create with network lookup');

        const lookupResult = await lookupObject(ctx, create.id);

        if (lookupResult === null) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to inability to lookup object, exit early',
            );

            return;
        }

        if (
            lookupResult instanceof Create &&
            String(create.id) !== String(lookupResult.id)
        ) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to local activity + remote activity ID mismatch, exit early',
            );

            return;
        }

        if (
            lookupResult instanceof Create &&
            lookupResult.id?.origin !== lookupResult.actorId?.origin
        ) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to remote activity + actor origin mismatch, exit early',
            );

            return;
        }

        if (
            (lookupResult instanceof Note || lookupResult instanceof Article) &&
            create.objectId?.href !== lookupResult.id?.href
        ) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to lookup returning Object and ID mismatch, exit early',
            );

            return;
        }

        // If everything checks out, use the remote create activity where we can
        // so that we can guarantee the integrity of the associated object (i.e
        // the object of the annouced activity has not been tampered with). We can
        // only do this if the lookupResult is a Create (which is not always the
        // case depending on the remote server's implementation - i.e WordPress is
        // returning the Note/Article object instead of a Create object).
        if (lookupResult instanceof Create) {
            create = lookupResult;
        }

        if (!create.id) {
            ctx.data.logger.info('Remote create missing id, exit early');

            return;
        }
    }

    // Persist create activity
    const createJson = await create.toJsonLd();
    ctx.data.globaldb.set([create.id.href], createJson);

    const object = await create.getObject();
    const replyTarget = await object?.getReplyTarget();

    if (replyTarget?.id?.href) {
        const data = await ctx.data.globaldb.get<any>([replyTarget.id.href]);
        const replyTargetAuthor = data?.attributedTo?.id;
        const inboxActor = await getUserData(ctx, 'index');

        if (replyTargetAuthor === inboxActor.id.href) {
            await addToList(ctx.data.db, ['inbox'], create.id.href);
            return;
        }
    }

    await addToList(ctx.data.db, ['inbox'], create.id.href);
}

export async function handleAnnounce(
    ctx: Context<ContextData>,
    announce: Announce,
) {
    ctx.data.logger.info('Handling Announce');

    // Check what was announced - If it's an Activity rather than an Object
    // (which can occur if the announcer is a Group - See
    // https://codeberg.org/fediverse/fep/src/branch/main/fep/1b12/fep-1b12.md),
    // we need to forward the announce on to an appropriate handler
    // This routing is something that should be handled by Fedify, but has
    // not yet been implemented - Tracked here: https://github.com/dahlia/fedify/issues/193
    const announced = await announce.getObject();

    if (announced instanceof Create) {
        return handleAnnoucedCreate(ctx, announce);
    }

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
    const existing =
        (await ctx.data.globaldb.get([announce.objectId.href])) ?? null;

    if (!existing) {
        ctx.data.logger.info(
            'Announce object not found in globalDb, performing network lookup',
        );
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
            if (
                'attributedTo' in objectJson &&
                typeof objectJson.attributedTo === 'string'
            ) {
                const actor = await lookupActor(ctx, objectJson.attributedTo);
                objectJson.attributedTo = await actor?.toJsonLd();
            }
        }

        ctx.data.globaldb.set([object.id.href], objectJson);
    }

    if (await isFollowing(sender, { db: ctx.data.db })) {
        await addToList(ctx.data.db, ['inbox'], announce.id.href);
        return;
    }
}

export async function handleLike(ctx: Context<ContextData>, like: Like) {
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
    const existing =
        (await ctx.data.globaldb.get([like.objectId.href])) ?? null;

    if (!existing) {
        ctx.data.logger.info(
            'Like object not found in globalDb, performing network lookup',
        );

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

    await addToList(ctx.data.db, ['inbox'], like.id.href);
}

export async function inboxErrorHandler(
    ctx: Context<ContextData>,
    error: unknown,
) {
    Sentry.captureException(error);
    ctx.data.logger.error('Error handling incoming activity: {error}', {
        error,
    });
}

export async function followersDispatcher(
    ctx: Context<ContextData>,
    handle: string,
    cursor: string | null,
) {
    ctx.data.logger.info('Followers Dispatcher');

    if (cursor === null) {
        ctx.data.logger.info('No cursor provided, returning early');

        return null;
    }

    const pageSize = Number.parseInt(
        process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE || '',
    );

    if (Number.isNaN(pageSize)) {
        throw new Error(`Page size: ${pageSize} is not valid`);
    }

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    let items: Recipient[] = [];

    const fullResults = (
        (await ctx.data.db.get<any[]>(['followers', 'expanded'])) ?? []
    ).filter((v, i, results) => {
        // Remove duplicates
        return results.findIndex((r) => r.id === v.id) === i;
    });

    if (fullResults) {
        nextCursor =
            fullResults.length > offset + pageSize
                ? (offset + pageSize).toString()
                : null;

        items = fullResults.slice(offset, offset + pageSize);
    } else {
        const results = [
            // Remove duplicates
            ...new Set((await ctx.data.db.get<string[]>(['followers'])) || []),
        ];

        nextCursor =
            results.length > offset + pageSize
                ? (offset + pageSize).toString()
                : null;

        const slicedResults = results.slice(offset, offset + pageSize);

        const actors = (
            await Promise.all(
                slicedResults.map((result) => lookupActor(ctx, result)),
            )
        )
            // This could potentially mean that the slicedResults is not the size
            // of pageSize if for some reason the lookupActor returns null for
            // some of the results. TODO: Find a better way to handle this
            .filter((item): item is Actor => isActor(item));

        const toStore = await Promise.all(
            actors.map((actor) => actor.toJsonLd() as any),
        );

        await ctx.data.db.set(['followers', 'expanded'], toStore);

        items = toStore;
    }

    return {
        items: (
            await Promise.all(items.map((item) => APObject.fromJsonLd(item)))
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
        ...new Set((await ctx.data.db.get<string[]>(['followers'])) || []),
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

    const pageSize = Number.parseInt(
        process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE || '',
    );

    if (Number.isNaN(pageSize)) {
        throw new Error(`Page size: ${pageSize} is not valid`);
    }

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    const results = (await ctx.data.db.get<string[]>(['following'])) || [];

    nextCursor =
        results.length > offset + pageSize
            ? (offset + pageSize).toString()
            : null;

    const slicedResults = results.slice(offset, offset + pageSize);

    ctx.data.logger.info('Following results', { results: slicedResults });

    const items = await Promise.all(
        slicedResults.map(async (result) => {
            try {
                return await lookupActor(ctx, result);
            } catch (err) {
                Sentry.captureException(err);
                ctx.data.logger.error('Error looking up following actor', {
                    error: err,
                });
            }
        }),
    ).then((results) => results.filter((r): r is Actor => isActor(r)));

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

    const pageSize = Number.parseInt(
        process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE || '',
    );

    if (Number.isNaN(pageSize)) {
        throw new Error(`Page size: ${pageSize} is not valid`);
    }

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    const results = filterOutboxActivityUris(
        (await ctx.data.db.get<string[]>(['outbox'])) || [],
    ).reverse();

    nextCursor =
        results.length > offset + pageSize
            ? (offset + pageSize).toString()
            : null;

    const slicedResults = results.slice(offset, offset + pageSize);

    ctx.data.logger.info('Outbox results', { results: slicedResults });

    const items: Activity[] = await Promise.all(
        slicedResults.map(async (result) => {
            try {
                const thing = await ctx.data.globaldb.get([result]);
                const activity = await Activity.fromJsonLd(thing);

                return activity;
            } catch (err) {
                Sentry.captureException(err);
                ctx.data.logger.error('Error getting outbox activity', {
                    error: err,
                });
                return null;
            }
        }),
    ).then((results) => results.filter((r): r is Activity => r !== null));

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

    const pageSize = Number.parseInt(
        process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE || '',
    );

    if (Number.isNaN(pageSize)) {
        throw new Error(`Page size: ${pageSize} is not valid`);
    }

    const offset = Number.parseInt(cursor ?? '0');
    let nextCursor: string | null = null;

    const results = ((await db.get<string[]>(['liked'])) || []).reverse();

    nextCursor =
        results.length > offset + pageSize
            ? (offset + pageSize).toString()
            : null;

    const slicedResults = results.slice(offset, offset + pageSize);

    ctx.data.logger.info('Liked results', { results: slicedResults });

    const items: Like[] = (
        await Promise.all(
            slicedResults.map(async (result) => {
                try {
                    const thing = await globaldb.get<{
                        object:
                            | string
                            | {
                                  [key: string]: any;
                              };
                        [key: string]: any;
                    }>([result]);

                    if (
                        thing &&
                        typeof thing.object !== 'string' &&
                        typeof thing.object.attributedTo === 'string'
                    ) {
                        const actor = await lookupActor(
                            apCtx,
                            thing.object.attributedTo,
                        );

                        if (actor) {
                            const json = await actor.toJsonLd();

                            if (typeof json === 'object' && json !== null) {
                                thing.object.attributedTo = json;
                            }
                        }
                    }

                    const activity = await Like.fromJsonLd(thing);
                    return activity;
                } catch (err) {
                    Sentry.captureException(err);
                    ctx.data.logger.error('Error getting liked activity', {
                        error: err,
                    });
                    return null;
                }
            }),
        )
    ).filter((item): item is Like => item !== null);

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

export async function nodeInfoDispatcher(ctx: RequestContext<ContextData>) {
    return {
        software: {
            name: 'ghost',
            version: { major: 0, minor: 1, patch: 0 },
            homepage: new URL('https://ghost.org/'),
            repository: new URL('https://github.com/TryGhost/Ghost'),
        },
        protocols: ['activitypub'] as Protocol[],
        openRegistrations: false,
        usage: {
            users: {},
            localPosts: 0,
            localComments: 0,
        },
    };
}
