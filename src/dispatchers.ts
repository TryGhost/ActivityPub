import {
    Article,
    Accept,
    Follow,
    Image,
    Person,
    RequestContext,
    lookupObject,
    generateCryptoKeyPair,
    exportJwk,
    importJwk,
    Create,
    Note,
    Activity,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';
import { addToList } from './kv-helpers';
import { ContextData } from './app';

type PersonData = {
    id: string;
    name: string;
    summary: string;
    preferredUsername: string;
    icon: string;
    inbox: string;
    outbox: string;
    following: string;
    followers: string;
};

async function getUserData(ctx: RequestContext<ContextData>, handle: string) {
    const existing = await ctx.data.db.get<PersonData>(['handle', handle]);

    if (existing) {
        let icon = null;
        try {
            icon = new Image({ url: new URL(existing.icon) });
        } catch (err) {
            console.log('Could not create Image from Icon value', existing.icon);
            console.log(err);
        }
        return {
            id: new URL(existing.id),
            name: existing.name,
            summary: existing.summary,
            preferredUsername: existing.preferredUsername,
            icon,
            inbox: new URL(existing.inbox),
            outbox: new URL(existing.outbox),
            following: new URL(existing.following),
            followers: new URL(existing.followers),
            publicKeys: (await ctx.getActorKeyPairs(handle)).map(
                (key) => key.cryptographicKey,
            ),
        };
    }

    const data = {
        id: ctx.getActorUri(handle),
        name: `Local Ghost site`,
        summary: 'This is a summary',
        preferredUsername: handle,
        icon: new Image({ url: new URL('https://ghost.org/favicon.ico') }),
        inbox: ctx.getInboxUri(handle),
        outbox: ctx.getOutboxUri(handle),
        following: ctx.getFollowingUri(handle),
        followers: ctx.getFollowersUri(handle),
        publicKeys: (await ctx.getActorKeyPairs(handle)).map(
            (key) => key.cryptographicKey,
        ),
    };

    const dataToStore: PersonData = {
        id: data.id.href,
        name: data.name,
        summary: data.summary,
        preferredUsername: data.preferredUsername,
        icon: 'https://ghost.org/favicon.ico',
        inbox: data.inbox.href,
        outbox: data.outbox.href,
        following: data.following.href,
        followers: data.followers.href,
    };

    await ctx.data.db.set(['handle', handle], data);

    return data;
}

async function getUserKeypair(ctx: ContextData, handle: string) {
    const existing = await ctx.db.get<{ publicKey: any; privateKey: any }>([
        'keypair',
        handle,
    ]);

    if (existing) {
        return {
            publicKey: await importJwk(existing.publicKey, 'public'),
            privateKey: await importJwk(existing.privateKey, 'private'),
        };
    }

    const keys = await generateCryptoKeyPair();

    const data = {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
    };

    await ctx.db.set(['keypair', handle], {
        publicKey: await exportJwk(data.publicKey),
        privateKey: await exportJwk(data.privateKey),
    });

    return data;
}

export async function actorDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    if (handle !== 'index') return null;

    const data = await getUserData(ctx, handle);

    const person = new Person(data);

    return person;
}

export async function keypairDispatcher(ctx: ContextData, handle: string) {
    if (handle !== 'index') return [];

    const data = await getUserKeypair(ctx, handle);

    if (!data) return [];

    return [data];
}

export async function handleFollow(
    ctx: RequestContext<ContextData>,
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
    ctx: RequestContext<ContextData>,
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
    ctx: RequestContext<ContextData>,
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

export async function inboxErrorHandler(
    ctx: RequestContext<ContextData>,
    error: unknown,
) {
    console.error('Error handling incoming activity');
    console.error(error);
}

export async function followersDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    console.log('Followers Dispatcher');
    const results = (await ctx.data.db.get<string[]>(['followers'])) || [];
    console.log(results);
    let items: Person[] = [];
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
    handle: string,
) {
    const results = (await ctx.data.db.get<string[]>(['following'])) || [];
    return results.length;
}

export async function outboxDispatcher(
    ctx: RequestContext<ContextData>,
    handle: string,
) {
    console.log('Outbox Dispatcher');
    const results = (await ctx.data.db.get<string[]>(['outbox'])) || [];
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
        items,
    };
}

export async function outboxCounter(
    ctx: RequestContext<ContextData>,
    handle: string,
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
