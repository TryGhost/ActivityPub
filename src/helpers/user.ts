import {
    Image,
    RequestContext,
    generateCryptoKeyPair,
    exportJwk,
    importJwk,
    Context,
} from '@fedify/fedify';
import { ContextData } from '../app';
import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY
} from '../constants';

export type PersonData = {
    id: string;
    name: string;
    summary: string;
    preferredUsername: string;
    icon: string;
    inbox: string;
    outbox: string;
    following: string;
    followers: string;
    liked?: string;
    url: string;
};

export async function getUserData(ctx: RequestContext<ContextData>, handle: string) {
    const existing = await ctx.data.db.get<PersonData>(['handle', handle]);

    if (existing) {
        let icon = null;
        try {
            icon = new Image({ url: new URL(existing.icon) });
        } catch (err) {
            console.log('Could not create Image from Icon value', existing.icon);
            console.log(err);
        }

        let url = null;
        try {
            url = new URL(existing.url);
        }  catch (err) {
            console.log('Could not create URL from value', existing.url);
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
            liked: existing.liked ? new URL(existing.liked) : ctx.getLikedUri(handle),
            publicKeys: (await ctx.getActorKeyPairs(handle)).map(
                (key) => key.cryptographicKey,
            ),
            url,
        };
    }

    const data = {
        id: ctx.getActorUri(handle),
        name: ACTOR_DEFAULT_NAME,
        summary: ACTOR_DEFAULT_SUMMARY,
        preferredUsername: handle,
        icon: new Image({ url: new URL(ACTOR_DEFAULT_ICON) }),
        inbox: ctx.getInboxUri(handle),
        outbox: ctx.getOutboxUri(handle),
        following: ctx.getFollowingUri(handle),
        followers: ctx.getFollowersUri(handle),
        liked: ctx.getLikedUri(handle),
        publicKeys: (await ctx.getActorKeyPairs(handle)).map(
            (key) => key.cryptographicKey,
        ),
        url: new URL(`https://${ctx.host}`),
    };

    const dataToStore: PersonData = {
        id: data.id.href,
        name: data.name,
        summary: data.summary,
        preferredUsername: data.preferredUsername,
        icon: ACTOR_DEFAULT_ICON,
        inbox: data.inbox.href,
        outbox: data.outbox.href,
        following: data.following.href,
        followers: data.followers.href,
        liked: data.liked.href,
        url: data.url.href,
    };

    await ctx.data.db.set(['handle', handle], dataToStore);

    return data;
}

export async function getUserKeypair(ctx: Context<ContextData>, handle: string) {
    const existing = await ctx.data.db.get<{ publicKey: any; privateKey: any }>([
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

    await ctx.data.db.set(['keypair', handle], {
        publicKey: await exportJwk(data.publicKey),
        privateKey: await exportJwk(data.privateKey),
    });

    return data;
}
