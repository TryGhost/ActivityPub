import { describe, expect, it, vi } from 'vitest';

import { Image } from '@fedify/fedify';

import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY,
} from '../constants';
import { getUserData } from './user';

const HANDLE = 'foo';
const ACTOR_URI = `https://example.com/${HANDLE}`;
const INBOX_URI = `https://example.com/${HANDLE}/inbox`;
const OUTBOX_URI = `https://example.com/${HANDLE}/outbox`;
const LIKED_URI = `https://example.com/${HANDLE}/liked`;
const FOLLOWING_URI = `https://example.com/${HANDLE}/following`;
const FOLLOWERS_URI = `https://example.com/${HANDLE}/followers`;

function getCtx() {
    const host = 'example.com';

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

    return ctx as any;
}

describe('getUserData', () => {
    it('persists a user to the database if it does not exist', async () => {
        const ctx = getCtx();

        ctx.data.db.get.mockResolvedValue(undefined);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: ACTOR_DEFAULT_NAME,
            summary: ACTOR_DEFAULT_SUMMARY,
            preferredUsername: HANDLE,
            icon: new Image({ url: new URL(ACTOR_DEFAULT_ICON) }),
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
            icon: ACTOR_DEFAULT_ICON,
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

    it('handles retrieving a user with an invalid icon', async () => {
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
            preferredUsername: HANDLE,
            icon: new Image({ url: new URL(ACTOR_DEFAULT_ICON) }),
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

    it('handles retrieving a user with an invalid URL', async () => {
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
