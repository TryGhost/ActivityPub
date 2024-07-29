import {
    Image,
    RequestContext,
    generateCryptoKeyPair,
    exportJwk,
    importJwk,
    Context,
} from '@fedify/fedify';
import { ContextData } from './app';

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

    await ctx.data.db.set(['handle', handle], data);

    return data;
}

export async function getUserKeypair(ctx: Context<ContextData>, handle: string) {
    const existing = await ctx.data.db.get<{ publicKey: JsonWebKey; privateKey: JsonWebKey }>([
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
