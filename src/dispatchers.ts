import {
    Article,
    Accept,
    Follow,
    Person,
    RequestContext,
    lookupObject,
    Create,
    Note,
    Activity,
    Update,
    Context,
    Announce,
    isActor,
    Actor,
    Object as APObject,
    Recipient,
    Like,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';
import { addToList } from './kv-helpers';
import { ContextData } from './app';
import { ACTOR_DEFAULT_HANDLE } from './constants';
import { getUserData, getUserKeypair } from './user';

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
    console.log('Handling Follow');
    if (!follow.id) {
        return;
    }
    const parsed = (ctx as any).parseUri(follow.objectId);
    if (parsed?.type !== 'actor') {
        // TODO Log
        return;
    }
    const sender = await follow.getActor(ctx);
    if (sender === null || sender.id === null) {
        return;
    }

    const currentFollowers = await ctx.data.db.get<string[]>(['followers']) ?? [];
    let shouldRecordFollower = currentFollowers.includes(sender.id.href) === false;

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

    // Add accept activity to outbox
    const acceptId = ctx.getObjectUri(Accept, { id: uuidv4() });
    const accept = new Accept({
        id: acceptId,
        actor: follow.objectId,
        object: follow,
    });
    const acceptJson = await accept.toJsonLd();

    await ctx.data.globaldb.set([accept.id!.href], acceptJson);
    await addToList(ctx.data.db, ['outbox'], accept.id!.href);

    // Send accept activity to sender
    await ctx.sendActivity({ handle: parsed.handle }, sender, accept);
}

export async function handleAccept(
    ctx: Context<ContextData>,
    accept: Accept,
) {
    console.log('Handling Accept');
    const parsed = (ctx as any).parseUri(accept.objectId);
    console.log(parsed);
    if (false && parsed?.type !== 'follow') {
        console.log('Not accepting a follow - exit');
        return;
    }
    if (!accept.id) {
        console.log('Accept missing id - exit');
        return;
    }

    const sender = await accept.getActor(ctx);
    console.log('Accept sender');
    console.log(sender);
    if (sender === null || sender.id === null) {
        console.log('Sender missing, exit early');
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
    console.log('Handling Create');
    const parsed = (ctx as any).parseUri(create.objectId);
    console.log(parsed);
    if (false && parsed?.type !== 'article') {
        console.log('Not accepting a follow - exit');
        return;
    }
    if (!create.id) {
        console.log('Accept missing id - exit');
        return;
    }

    const sender = await create.getActor(ctx);
    if (sender === null || sender.id === null) {
        console.log('Sender missing, exit early');
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
    console.log('Handling Announce');

    // Validate announce
    if (!announce.id) {
        console.log('Invalid Announce - no id');
        return;
    }

    if (!announce.objectId) {
        console.log('Invalid Announce - no object id');
        return;
    }

    // Validate sender
    const sender = await announce.getActor(ctx);

    if (sender === null || sender.id === null) {
        console.log('Sender missing, exit early');
        return;
    }

    // Lookup announced object - If not found in globalDb, perform network lookup
    let object = null;
    let existing = await ctx.data.globaldb.get([announce.objectId.href]) ?? null;

    if (!existing) {
        console.log('Object not found in globalDb, performing network lookup');

        object = await lookupObject(announce.objectId);
    }

    // Validate object
    if (!existing && !object) {
        console.log('Invalid Announce - could not find object');
        return;
    }

    if (object && !object.id) {
        console.log('Invalid Announce - could not find object id');
        return;
    }

    // Persist announce
    const announceJson = await announce.toJsonLd();
    ctx.data.globaldb.set([announce.id.href], announceJson);

    // Persist object if not already persisted
    if (!existing && object && object.id) {
        console.log('Storing object in globalDb');

        const objectJson = await object.toJsonLd();

        if (typeof objectJson === 'object' && objectJson !== null) {
            if ('attributedTo' in objectJson && typeof objectJson.attributedTo === 'string') {
                const actor = await ctx.data.globaldb.get([objectJson.attributedTo]) ?? await lookupObject(objectJson.attributedTo)
                objectJson.attributedTo = await (actor as any)?.toJsonLd();
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
    console.log('Handling Like');

    // Validate like
    if (!like.id) {
        console.log('Invalid Like - no id');
        return;
    }

    if (!like.objectId) {
        console.log('Invalid Like - no object id');
        return;
    }

    // Validate sender
    const sender = await like.getActor(ctx);

    if (sender === null || sender.id === null) {
        console.log('Sender missing, exit early');
        return;
    }

    // Lookup liked object - If not found in globalDb, perform network lookup
    let object = null;
    let existing = await ctx.data.globaldb.get([like.objectId.href]) ?? null;

    if (!existing) {
        console.log('Object not found in globalDb, performing network lookup');

        object = await like.getObject();
    }

    // Validate object
    if (!existing && !object) {
        console.log('Invalid Like - could not find object');
        return;
    }

    if (object && !object.id) {
        console.log('Invalid Like - could not find object id');
        return;
    }

    // Persist like
    const likeJson = await like.toJsonLd();
    ctx.data.globaldb.set([like.id.href], likeJson);

    // Persist object if not already persisted
    if (!existing && object && object.id) {
        console.log('Storing object in globalDb');

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
    console.error('Error handling incoming activity');
    console.error(error);
}

async function lookupActor(ctx: RequestContext<ContextData>, url: string) {
    try {
        console.log('Looking up actor locally', url);
        const local = await ctx.data.globaldb.get([url]);
        return await APObject.fromJsonLd(local);
    } catch (err) {
        console.log('Error looking up actor locally', url);
        console.log(err);
        console.log('Looking up actor remotely', url);
        const documentLoader = await ctx.getDocumentLoader({handle: 'index'});
        try {
            const remote = await lookupObject(url, {documentLoader});
            if (isActor(remote)) {
                await ctx.data.globaldb.set([url], await remote.toJsonLd());
                return remote;
            }
        } catch (err) {
            console.log('Error looking up actor remotely', url);
            console.log(err)
            return null;
        }
    }
    return null;
}

function convertJsonLdToRecipient(result: any): Recipient {
    return {
        ...result,
        id: new URL(result.id),
        inboxId: new URL(result.inbox),
        endpoints: result.endpoints?.sharedInbox != null
            ? { sharedInbox: new URL(result.endpoints.sharedInbox) }
            : null,
    };
}

export async function followersDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    console.log('Followers Dispatcher');
    let items: Recipient[] = [];
    const fullResults = await ctx.data.db.get<any[]>(['followers', 'expanded']);
    if (fullResults) {
        items = fullResults.map(convertJsonLdToRecipient)
    } else {
        const results = (await ctx.data.db.get<string[]>(['followers'])) || [];
        const actors = items = (await Promise.all(results.map((result) => lookupActor(ctx, result))))
            .filter((item): item is Actor => isActor(item))
        const toStore = await Promise.all(actors.map(actor => actor.toJsonLd() as any));
        await ctx.data.db.set(['followers', 'expanded'], toStore);
        items = toStore.map(convertJsonLdToRecipient);
    }
    return {
        items,
    };
}

export async function followersCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['followers'])) || [];
    return results.length;
}

export async function followingDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    console.log('Following Dispatcher');
    const results = (await ctx.data.db.get<string[]>(['following'])) || [];
    console.log(results);
    let items: Person[] = [];
    for (const result of results) {
        try {
            const thing = await lookupActor(ctx, result);
            if (thing instanceof Person) {
                items.push(thing);
            }
        } catch (err) {
            console.log(err);
        }
    }
    return {
        items,
    };
}

export async function followingCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['following'])) || [];
    return results.length;
}

function filterOutboxActivityUris (activityUris: string[]) {
    // Only return Create and Announce activityUris
    return activityUris.filter(uri => /(create|announce)/.test(uri));
}

export async function outboxDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    console.log('Outbox Dispatcher');
    const results = filterOutboxActivityUris((await ctx.data.db.get<string[]>(['outbox'])) || []);
    console.log(results);

    let items: Activity[] = [];
    for (const result of results) {
        try {
            const thing = await ctx.data.globaldb.get([result]);
            const activity = await Activity.fromJsonLd(thing);
            items.push(activity);
        } catch (err) {
            console.log(err);
        }
    }
    return {
        items: items.reverse(),
    };
}

export async function outboxCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['outbox'])) || [];

    return filterOutboxActivityUris(results).length;
}

export async function likedDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    console.log('Liked Dispatcher');
    const results = (await ctx.data.db.get<string[]>(['liked'])) || [];
    console.log(results);

    let items: Like[] = [];
    for (const result of results) {
        try {
            const thing = await ctx.data.globaldb.get([result]);
            const activity = await Like.fromJsonLd(thing);
            items.push(activity);
        } catch (err) {
            console.log(err);
        }
    }
    return {
        items: items.reverse(),
    };
}

export async function likedCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['liked'])) || [];

    return results.length;
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
