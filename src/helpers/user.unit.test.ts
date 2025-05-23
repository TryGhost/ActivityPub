import { describe, expect, it, vi } from 'vitest';

import { Image } from '@fedify/fedify';

import { getUserData } from './user';

const HANDLE = 'foo';
const ACTOR_URI = `https://www.example.com/${HANDLE}`;
const INBOX_URI = `https://www.example.com/${HANDLE}/inbox`;
const OUTBOX_URI = `https://www.example.com/${HANDLE}/outbox`;
const LIKED_URI = `https://www.example.com/${HANDLE}/liked`;
const FOLLOWING_URI = `https://www.example.com/${HANDLE}/following`;
const FOLLOWERS_URI = `https://example.com/${HANDLE}/followers`;

function getCtx() {
    const host = 'www.example.com';

    const ctx = {
        data: {
            db: {
                get: vi.fn(),
                set: vi.fn(),
            },
            logger: {
                info: vi.fn(),
                error: vi.fn(),
            },
        },
        getActorKeyPairs: vi.fn(),
        getActorUri: vi.fn(),
        getInboxUri: vi.fn(),
        getOutboxUri: vi.fn(),
        getLikedUri: vi.fn(),
        getFollowingUri: vi.fn(),
        getFollowersUri: vi.fn(),
        host,
    };

    ctx.getActorKeyPairs.mockImplementation((handle) => {
        return Promise.resolve(
            handle === HANDLE ? [{ cryptographicKey: 'abc123' }] : [],
        );
    });
    ctx.getActorUri.mockImplementation((handle) => {
        return handle === HANDLE ? new URL(ACTOR_URI) : undefined;
    });
    ctx.getInboxUri.mockImplementation((handle) => {
        return handle === HANDLE ? new URL(INBOX_URI) : undefined;
    });
    ctx.getOutboxUri.mockImplementation((handle) => {
        return handle === HANDLE ? new URL(OUTBOX_URI) : undefined;
    });
    ctx.getFollowingUri.mockImplementation((handle) => {
        return handle === HANDLE ? new URL(FOLLOWING_URI) : undefined;
    });
    ctx.getLikedUri.mockImplementation((handle) => {
        return handle === HANDLE ? new URL(LIKED_URI) : undefined;
    });
    ctx.getFollowersUri.mockImplementation((handle) => {
        return handle === HANDLE ? new URL(FOLLOWERS_URI) : undefined;
    });

    // TODO: Clean up the any type
    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
    return ctx as any;
}

describe('getUserData', () => {
    it('persists a user to the database if it does not exist', async () => {
        const ctx = getCtx();

        ctx.data.db.get.mockResolvedValue(undefined);

        const result = await getUserData(ctx, HANDLE);

        const normalizedHost = ctx.host.replace(/^www\./, '');
        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: normalizedHost,
            summary: null,
            preferredUsername: HANDLE,
            icon: null,
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            liked: new URL(LIKED_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: new URL(`https://${ctx.host}`),
        };

        expect(ctx.data.db.set).toBeCalledTimes(1);
        expect(ctx.data.db.set).toBeCalledWith(['handle', HANDLE], {
            id: expectedUserData.id.href,
            name: expectedUserData.name,
            summary: expectedUserData.summary,
            preferredUsername: expectedUserData.preferredUsername,
            icon: null,
            inbox: expectedUserData.inbox.href,
            outbox: expectedUserData.outbox.href,
            liked: expectedUserData.liked.href,
            following: expectedUserData.following.href,
            followers: expectedUserData.followers.href,
            url: expectedUserData.url.href,
        });

        expect(result).toEqual(expectedUserData);
    });

    it('retrieves a user from the database', async () => {
        const ctx = getCtx();

        const persistedUser = {
            id: `https://${ctx.host}/${HANDLE}`,
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: `https://${ctx.host}/icon.png`,
            inbox: INBOX_URI,
            outbox: OUTBOX_URI,
            liked: LIKED_URI,
            following: FOLLOWING_URI,
            followers: FOLLOWERS_URI,
            url: `https://${ctx.host}`,
        };

        ctx.data.db.get.mockResolvedValue(persistedUser);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: new Image({ url: new URL(`https://${ctx.host}/icon.png`) }),
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            liked: new URL(LIKED_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: new URL(`https://${ctx.host}`),
        };

        expect(ctx.data.db.set).toBeCalledTimes(0);
        expect(result).toEqual(expectedUserData);
    });

    it('handles retrieving a user with a missing icon', async () => {
        const ctx = getCtx();

        const persistedUser = {
            id: `https://${ctx.host}/${HANDLE}`,
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            inbox: INBOX_URI,
            outbox: OUTBOX_URI,
            liked: LIKED_URI,
            following: FOLLOWING_URI,
            followers: FOLLOWERS_URI,
            url: `https://${ctx.host}`,
        };

        ctx.data.db.get.mockResolvedValue(persistedUser);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: 'foo',
            summary: 'bar',
            icon: null,
            preferredUsername: HANDLE,
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            liked: new URL(LIKED_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: new URL(`https://${ctx.host}`),
        };

        expect(ctx.data.db.set).toBeCalledTimes(0);
        expect(result).toEqual(expectedUserData);
    });

    it('handles retrieving a user with a missing URL', async () => {
        const ctx = getCtx();

        const persistedUser = {
            id: `https://${ctx.host}/${HANDLE}`,
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: `https://${ctx.host}/icon.png`,
            inbox: INBOX_URI,
            outbox: OUTBOX_URI,
            liked: LIKED_URI,
            following: FOLLOWING_URI,
            followers: FOLLOWERS_URI,
        };

        ctx.data.db.get.mockResolvedValue(persistedUser);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: new Image({ url: new URL(`https://${ctx.host}/icon.png`) }),
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            liked: new URL(LIKED_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: new URL(`https://${ctx.host}`),
        };

        expect(ctx.data.db.set).toBeCalledTimes(0);
        expect(result).toEqual(expectedUserData);
    });
});
