import {
    type Context,
    type CryptographicKey,
    Image,
    exportJwk,
    generateCryptoKeyPair,
    importJwk,
} from '@fedify/fedify';
import type { ContextData } from '../app';

export type PersonData = {
    id: string;
    name: string;
    summary: string | null;
    preferredUsername: string;
    icon: string | null;
    inbox: string;
    outbox: string;
    following: string;
    followers: string;
    liked?: string;
    url: string;
};

export type UserData = {
    id: URL;
    name: string;
    summary: string | null;
    preferredUsername: string;
    icon: Image | null;
    inbox: URL;
    outbox: URL;
    following: URL;
    followers: URL;
    liked: URL;
    url: URL;
    publicKeys: CryptographicKey[];
};

export async function getUserData(
    ctx: Context<ContextData>,
    handle: string,
): Promise<UserData> {
    const existing = await ctx.data.db.get<PersonData>(['handle', handle]);

    if (existing) {
        let icon = null;
        if (existing.icon) {
            try {
                icon = new Image({ url: new URL(existing.icon) });
            } catch (err) {
                ctx.data.logger.error(
                    'Could not create Image from Icon value ({icon}): {error}',
                    { icon: existing.icon, error: err },
                );
            }
        }

        let url = null;
        try {
            url = new URL(existing.url);
        } catch (err) {
            ctx.data.logger.error(
                'Could not create URL from value ({url}): {error}',
                { url: existing.url, error: err },
            );
            url = new URL(`https://${ctx.host}`);
        }
        try {
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
                liked: existing.liked
                    ? new URL(existing.liked)
                    : ctx.getLikedUri(handle),
                publicKeys: (await ctx.getActorKeyPairs(handle)).map(
                    (key) => key.cryptographicKey,
                ),
                url,
            };
        } catch (err) {
            ctx.data.logger.error(
                'Could not create UserData from store value (id: {id}): {error}',
                { id: existing.id, error: err },
            );
        }
    }

    const normalizedHost = ctx.host.replace(/^www\./, '');
    const data = {
        id: ctx.getActorUri(handle),
        name: normalizedHost,
        summary: null,
        preferredUsername: handle,
        icon: null,
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

    await setUserData(ctx, data, handle);

    return data;
}

// TODO: Consider using handle from `data`
export async function setUserData(
    ctx: Context<ContextData>,
    data: UserData,
    handle: string,
) {
    const iconUrl = data.icon?.url?.toString() || null;
    const dataToStore: PersonData = {
        id: data.id.href,
        name: data.name,
        summary: data.summary,
        preferredUsername: data.preferredUsername,
        icon: iconUrl,
        inbox: data.inbox.href,
        outbox: data.outbox.href,
        following: data.following.href,
        followers: data.followers.href,
        liked: data.liked.href,
        url: data.url.href,
    };

    await ctx.data.db.set(['handle', handle], dataToStore);
}

export async function getUserKeypair(
    ctx: Context<ContextData>,
    handle: string,
) {
    // TODO: Clean up the any types
    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
    const existing = await ctx.data.db.get<{ publicKey: any; privateKey: any }>(
        ['keypair', handle],
    );

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
