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
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';
import { addToList } from './kv-helpers';
import { ContextData } from './app';
import { getUserData, getUserKeypair } from './user';

export async function actorDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    if (handle !== 'index') return null;

    const data = await getUserData(ctx, handle);

    const person = new Person(data);

    return person;
}

export async function keypairDispatcher(ctx: Context<ContextData>, handle: string) {
    if (handle !== 'index') return [];

    const data = await getUserKeypair(ctx, handle);

    if (!data) return [];

    return [data];
}

export async function handleFollow(
    ctx: Context<ContextData>,
    follow: Follow,
) {
    console.log('Handling Follow');
    if (!follow.id || !follow.objectId) {
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
    const senderJson = await sender.toJsonLd();
    const followJson = await follow.toJsonLd();
    ctx.data.globaldb.set([follow.id.href], followJson);
    ctx.data.globaldb.set([sender.id.href], senderJson);
    await addToList(ctx.data.db, ['inbox'], follow.id.href);
    await addToList(ctx.data.db, ['followers'], sender.id.href);

    const acceptId = ctx.getObjectUri(Accept, { id: uuidv4() });
    const accept = new Accept({
        id: acceptId,
        actor: follow.objectId,
        object: follow,
    });
    const acceptJson = await accept.toJsonLd();

    await ctx.data.globaldb.set([accept.id!.href], acceptJson);
    await addToList(ctx.data.db, ['outbox'], accept.id!.href);
    await ctx.sendActivity({ handle: parsed.handle }, sender, accept);
}

export async function handleAccept(
    ctx: Context<ContextData>,
    accept: Accept,
) {
    console.log('Handling Accept');
    if (!accept.objectId) {
        return;
    }
    const parsed = ctx.parseUri(accept.objectId);
    console.log(parsed);
    // if (false && parsed?.type !== 'follow') {
    //     console.log('Not accepting a follow - exit');
    //     return;
    // }
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

    if (create.objectId === null) {
        console.log('Create missing objectId - exit');
        return;
    }

    const parsed = ctx.parseUri(create.objectId);
    console.log(parsed);
    // if (false && parsed?.type !== 'article') {
    //     console.log('Not accepting a follow - exit');
    //     return;
    // }
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

export async function inboxErrorHandler(
    ctx: Context<ContextData>,
    error: unknown,
) {
    console.error('Error handling incoming activity');
    console.error(error);
}

export async function followersDispatcher(
    ctx: RequestContext<ContextData>,
) {
    console.log('Followers Dispatcher');
    const results = (await ctx.data.db.get<string[]>(['followers'])) || [];
    console.log(results);
    const items: Person[] = [];
    for (const result of results) {
        try {
            const thing = await lookupObject(result);
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

export async function followersCounter(
    ctx: RequestContext<ContextData>,
) {
    const results = (await ctx.data.db.get<string[]>(['followers'])) || [];
    return results.length;
}

export async function followingDispatcher(
    ctx: RequestContext<ContextData>,
) {
    console.log('Following Dispatcher');
    const results = (await ctx.data.db.get<string[]>(['following'])) || [];
    console.log(results);
    const items: Person[] = [];
    for (const result of results) {
        try {
            const thing = await lookupObject(result);
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
) {
    const results = (await ctx.data.db.get<string[]>(['following'])) || [];
    return results.length;
}

export async function outboxDispatcher(
    ctx: RequestContext<ContextData>,
) {
    console.log('Outbox Dispatcher');
    const results = (await ctx.data.db.get<string[]>(['outbox'])) || [];
    console.log(results);
    const items: Activity[] = [];
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
        items,
    };
}

export async function outboxCounter(
    ctx: RequestContext<ContextData>,
) {
    const results = (await ctx.data.db.get<string[]>(['outbox'])) || [];
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
