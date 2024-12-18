import { describe, expect, it, vi } from 'vitest';

import {
    type Actor,
    type KvStore,
    PropertyValue,
    type RequestContext,
} from '@fedify/fedify';

import type { Logger } from '@logtape/logtape';
import type { ContextData } from '../../app';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    isFollowing,
    isHandle,
    updateSiteActor,
} from './actor';

describe('getAttachments', () => {
    it('should return an array of attachments for the actor', async () => {
        const actor = {
            getAttachments: vi.fn().mockImplementation(async function* () {
                yield new PropertyValue({ name: 'foo', value: 'bar' });
                yield new PropertyValue({ name: 'baz', value: 'qux' });
            }),
        } as unknown as Actor;

        expect(await getAttachments(actor)).toEqual([
            { name: 'foo', value: 'bar' },
            { name: 'baz', value: 'qux' },
        ]);
    });

    it('should skip non PropertyValue attachments', async () => {
        const actor = {
            getAttachments: vi.fn().mockImplementation(async function* () {
                yield { name: 'foo', value: 'bar' };
                yield new PropertyValue({ name: 'baz', value: 'qux' });
            }),
        } as unknown as Actor;

        expect(await getAttachments(actor)).toEqual([
            { name: 'baz', value: 'qux' },
        ]);
    });

    it('should use a default name if the attachment name is not available', async () => {
        const actor = {
            getAttachments: vi.fn().mockImplementation(async function* () {
                yield new PropertyValue({ value: 'bar' });
            }),
        } as unknown as Actor;

        expect(await getAttachments(actor)).toEqual([
            { name: '', value: 'bar' },
        ]);
    });

    it('should use a default value if the attachment value is not available', async () => {
        const actor = {
            getAttachments: vi.fn().mockImplementation(async function* () {
                yield new PropertyValue({ name: 'foo' });
            }),
        } as unknown as Actor;

        expect(await getAttachments(actor)).toEqual([
            { name: 'foo', value: '' },
        ]);
    });

    it('should sanitize the attachment value if a sanitizeValue function is provided', async () => {
        const actor = {
            getAttachments: vi.fn().mockImplementation(async function* () {
                yield new PropertyValue({
                    name: 'foo',
                    value: '<script>alert("XSS")</script>',
                });
            }),
        } as unknown as Actor;

        expect(
            await getAttachments(actor, {
                sanitizeValue: (value) =>
                    value
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;'),
            }),
        ).toEqual([
            {
                name: 'foo',
                value: '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;',
            },
        ]);
    });
});

describe('getFollowerCount', () => {
    it('should return the follower count for the actor', async () => {
        const actor = {
            getFollowers: vi.fn().mockResolvedValue({ totalItems: 100 }),
        } as unknown as Actor;

        expect(await getFollowerCount(actor)).toBe(100);
    });

    it('should return 0 if the actor followers are not available', async () => {
        const actor = {
            getFollowers: vi.fn().mockResolvedValue(null),
        } as unknown as Actor;

        expect(await getFollowerCount(actor)).toBe(0);
    });
});

describe('getFollowingCount', () => {
    it('should return the following count for the actor', async () => {
        const actor = {
            getFollowing: vi.fn().mockResolvedValue({ totalItems: 100 }),
        } as unknown as Actor;

        expect(await getFollowingCount(actor)).toBe(100);
    });

    it('should return 0 if the actor following is not available', async () => {
        const actor = {
            getFollowing: vi.fn().mockResolvedValue(null),
        } as unknown as Actor;

        expect(await getFollowingCount(actor)).toBe(0);
    });
});

describe('getHandle', () => {
    it('should return a handle for the actor', () => {
        const actor = {
            id: new URL('https://example.com/users/foo'),
            preferredUsername: 'foo',
        } as unknown as Actor;

        expect(getHandle(actor)).toBe('@foo@example.com');
    });

    it('should return a handle if the actor id is not available', () => {
        const actor = {
            preferredUsername: 'foo',
        } as unknown as Actor;

        expect(getHandle(actor)).toBe('@foo@unknown');
    });

    it('should return a handle if the actor preferredUsername is not available', () => {
        const actor = {
            id: new URL('https://example.com/users/foo'),
        } as unknown as Actor;

        expect(getHandle(actor)).toBe('@unknown@example.com');
    });

    it('should return a handle if the actor id and preferredUsername are not available', () => {
        const actor = {} as unknown as Actor;

        expect(getHandle(actor)).toBe('@unknown@unknown');
    });
});

describe('isFollowing', () => {
    it('should return a boolean indicating if the current user is following the given actor', async () => {
        const db = {
            get: vi
                .fn()
                .mockResolvedValue([
                    'https://example.com/users/foo',
                    'https://example.com/users/bar',
                    'https://example.com/users/baz',
                ]),
        } as unknown as KvStore;

        const followedActor = {
            id: new URL('https://example.com/users/bar'),
        } as unknown as Actor;

        const unfollowedActor = {
            id: new URL('https://example.com/users/qux'),
        } as unknown as Actor;

        expect(await isFollowing(followedActor, { db })).toBe(true);
        expect(await isFollowing(unfollowedActor, { db })).toBe(false);
    });

    it('should return false if the follower list is not available', async () => {
        const db = {
            get: vi.fn().mockResolvedValue(null),
        } as unknown as KvStore;

        const actor = {
            id: new URL('https://example.com/users/foo'),
        } as unknown as Actor;

        expect(await isFollowing(actor, { db })).toBe(false);
    });

    it('should return false if the actor id is not available', async () => {
        const db = {
            get: vi
                .fn()
                .mockResolvedValue([
                    'https://example.com/users/foo',
                    'https://example.com/users/bar',
                    'https://example.com/users/baz',
                ]),
        } as unknown as KvStore;

        const actor = {
            id: null,
        } as unknown as Actor;

        expect(await isFollowing(actor, { db })).toBe(false);
    });
});

describe('isHandle', () => {
    it('should return a boolean indicating if the provided string is a handle', () => {
        expect(isHandle('@foo@example.com')).toBe(true);
        expect(isHandle('@foo@example.com/bar')).toBe(false);
        expect(isHandle('@foo@example')).toBe(false);
        expect(isHandle('@example.com')).toBe(false);
        expect(isHandle('@foo')).toBe(false);
        expect(isHandle('@@foo')).toBe(false);
        expect(isHandle('@foo@')).toBe(false);
        expect(isHandle('@foo@@example.com')).toBe(false);
    });
});

describe('updateSiteActor', () => {
    function mockApContext(db: KvStore, globaldb: KvStore) {
        return {
            data: {
                db,
                globaldb,
                logger: console as unknown as Logger,
            },
            getActor: vi.fn().mockResolvedValue({}),
            getInboxUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com/inbox')),
            getOutboxUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com/outbox')),
            getLikedUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com/liked')),
            getFollowingUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com/following')),
            getActorUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com/user/1')),
            getActorKeyPairs: vi.fn().mockReturnValue([
                {
                    cryptographicKey: 'abc123',
                },
            ]),
            getObjectUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com')),
            getFollowersUri: vi
                .fn()
                .mockReturnValue(new URL('https://example.com/followers')),
            sendActivity: vi.fn(),
            host: 'example.com',
        } as unknown as RequestContext<ContextData>;
    }

    it('should return false if the site settings have not changed', async () => {
        const db = {
            get: vi.fn().mockResolvedValue({
                id: 'https://example.com/user/1',
                name: 'Site Title',
                summary: 'Site Description',
                preferredUsername: 'index',
                icon: 'https://example.com/icon.png',
                inbox: 'https://example.com/inbox',
                outbox: 'https://example.com/outbox',
                following: 'https://example.com/following',
                followers: 'https://example.com/followers',
                liked: 'https://example.com/liked',
                url: 'https://example.com/',
            }),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const globaldb = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                description: 'Site Description',
                title: 'Site Title',
                icon: 'https://example.com/icon.png',
            },
        });

        const apCtx = mockApContext(db, globaldb);

        const result = await updateSiteActor(apCtx, getSiteSettings);

        expect(result).toBe(false);
    });

    it('should update the site actor if one does not exist', async () => {
        const db = {
            get: vi.fn().mockResolvedValue(undefined),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const globaldb = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                description: 'New Site Description',
                title: 'New Site Title',
                icon: 'https://example.com/icon.png',
            },
        });

        const apCtx = mockApContext(db, globaldb);

        const result = await updateSiteActor(apCtx, getSiteSettings);

        expect(result).toBe(true);

        expect(db.set.mock.lastCall?.[1]).toStrictEqual({
            id: 'https://example.com/user/1',
            name: 'New Site Title',
            summary: 'New Site Description',
            preferredUsername: 'index',
            icon: 'https://example.com/icon.png',
            inbox: 'https://example.com/inbox',
            outbox: 'https://example.com/outbox',
            following: 'https://example.com/following',
            followers: 'https://example.com/followers',
            liked: 'https://example.com/liked',
            url: 'https://example.com/',
        });
    });

    it('should update the site actor if the site settings have changed', async () => {
        const db = {
            get: vi.fn().mockResolvedValue({
                id: 'https://example.com/user/1',
                name: 'Site Title',
                summary: 'Site Description',
                preferredUsername: 'index',
                icon: 'https://example.com/icon.png',
                inbox: 'https://example.com/inbox',
                outbox: 'https://example.com/outbox',
                following: 'https://example.com/following',
                followers: 'https://example.com/followers',
                liked: 'https://example.com/liked',
                url: 'https://example.com/',
            }),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const globaldb = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn(),
            delete: vi.fn(),
        };

        const getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                description: 'New Site Description',
                title: 'New Site Title',
                icon: 'https://example.com/icon.png',
            },
        });

        const apCtx = mockApContext(db, globaldb);

        const result = await updateSiteActor(apCtx, getSiteSettings);

        expect(result).toBe(true);

        expect(db.set.mock.calls[0][1]).toStrictEqual({
            id: 'https://example.com/user/1',
            name: 'New Site Title',
            summary: 'New Site Description',
            preferredUsername: 'index',
            icon: 'https://example.com/icon.png',
            inbox: 'https://example.com/inbox',
            outbox: 'https://example.com/outbox',
            following: 'https://example.com/following',
            followers: 'https://example.com/followers',
            liked: 'https://example.com/liked',
            url: 'https://example.com/',
        });
    });
});
