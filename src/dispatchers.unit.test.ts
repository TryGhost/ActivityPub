import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    Activity,
    type Actor,
    Like,
    Person,
    type RequestContext,
} from '@fedify/fedify';
import {
    actorDispatcher,
    followingDispatcher,
    likedDispatcher,
    nodeInfoDispatcher,
    outboxDispatcher,
} from './dispatchers';

import { ACTOR_DEFAULT_HANDLE } from './constants';
import * as lookupHelpers from './lookup-helpers';

vi.mock('./app', () => ({
    fedify: {
        createContext: vi.fn(),
    },
}));

describe('dispatchers', () => {
    describe('actorDispatcher', () => {
        it(`returns null if the handle is not "${ACTOR_DEFAULT_HANDLE}"`, async () => {
            const ctx = {} as RequestContext<any>;
            const handle = 'anything';

            const actual = await actorDispatcher(ctx, handle);
            const expected = null;

            expect(actual).toEqual(expected);
        });
    });

    describe('followingDispatcher', () => {
        const following: Record<string, any> = {
            'https://example.com/person/123': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                id: 'https://example.com/person/123',
                type: 'Person',
            },
            'https://example.com/person/456': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                type: 'Person',
                id: 'https://example.com/person/456',
            },
        };

        const ctx = {
            data: {
                db: {
                    get: vi.fn(),
                },
                globaldb: {
                    get: vi.fn(),
                },
                logger: {
                    info: vi.fn(),
                },
            },
        } as RequestContext<any>;

        beforeEach(() => {
            ctx.data.db.get.mockImplementation((key: string[]) => {
                return Promise.resolve(
                    key[0] === 'following' ? Object.keys(following) : undefined,
                );
            });

            ctx.data.globaldb.get.mockImplementation((key: string[]) => {
                return Promise.resolve(following[key[0]]);
            });

            if (!process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE) {
                process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE = '2';
            }
        });

        it('returns items from the following collection in the correct order', async () => {
            const result = await followingDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                null,
            );

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct items are returned in the correct order
            expect(result.items.length).toEqual(2);
            expect(result.items[0] instanceof Person).toBeTruthy();
            expect(result.items[1] instanceof Person).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual(
                'https://example.com/person/123',
            );
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[1].id.toString()).toEqual(
                'https://example.com/person/456',
            );
        });

        it('returns items from the following collection with a cursor', async () => {
            const result = await followingDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                '1',
            );

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct items are returned
            expect(result.items.length).toEqual(1);
            expect(result.items[0] instanceof Person).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual(
                'https://example.com/person/456',
            );
        });
    });

    describe('likedDispatcher', () => {
        const likeActivities: Record<string, any> = {
            'https://example.com/like/123': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                id: 'https://example.com/like/123',
                type: 'Like',
                object: {
                    id: 'https://example.com/note/123',
                    type: 'Note',
                },
            },
            'https://example.com/like/456': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                id: 'https://example.com/like/456',
                type: 'Like',
                object: {
                    id: 'https://example.com/note/456',
                    type: 'Note',
                },
            },
        };

        const ctx = {
            data: {
                db: {
                    get: vi.fn(),
                },
                globaldb: {
                    get: vi.fn(),
                },
                logger: {
                    info: vi.fn(),
                },
            },
        } as RequestContext<any>;

        beforeEach(() => {
            ctx.data.db.get.mockImplementation((key: string[]) => {
                return Promise.resolve(
                    key[0] === 'liked'
                        ? Object.keys(likeActivities)
                        : undefined,
                );
            });

            ctx.data.globaldb.get.mockImplementation((key: string[]) => {
                return Promise.resolve(likeActivities[key[0]]);
            });

            if (!process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE) {
                process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE = '2';
            }
        });

        it('returns items from the liked collection in the correct order', async () => {
            const result = await likedDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                null,
            );

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct items are returned in the correct order
            expect(result.items.length).toEqual(2);
            expect(result.items[0] instanceof Like).toBeTruthy();
            expect(result.items[1] instanceof Like).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual(
                'https://example.com/like/456',
            );
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[1].id.toString()).toEqual(
                'https://example.com/like/123',
            );
        });

        it('returns items from the liked collection with a cursor', async () => {
            const result = await likedDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                '1',
            );

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct items are returned
            expect(result.items.length).toEqual(1);
            expect(result.items[0] instanceof Activity).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual(
                'https://example.com/like/123',
            );
        });

        it('hydrates the object of a like', async () => {
            const actorId = 'https://example.com/actor/123';

            const likeActivities: Record<string, any> = {
                'https://example.com/like/123': {
                    '@context': [
                        'https://www.w3.org/ns/activitystreams',
                        'https://w3id.org/security/data-integrity/v1',
                    ],
                    id: 'https://example.com/like/123',
                    type: 'Like',
                    object: {
                        id: 'https://example.com/note/123',
                        type: 'Note',
                        attributedTo: actorId,
                    },
                },
            };

            ctx.data.globaldb.get.mockImplementation((key: string[]) => {
                return Promise.resolve(likeActivities[key[0]]);
            });

            ctx.data.db.get.mockImplementation((key: string[]) => {
                return Promise.resolve(
                    key[0] === 'liked'
                        ? Object.keys(likeActivities)
                        : undefined,
                );
            });

            vi.spyOn(lookupHelpers, 'lookupActor').mockImplementation(() => {
                return new Person({
                    id: new URL(actorId),
                }) as unknown as Promise<Actor>;
            });

            const result = await likedDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                null,
            );

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct item is returned
            expect(result.items.length).toEqual(1);
            expect(result.items[0] instanceof Like).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual(
                'https://example.com/like/123',
            );

            // Check the object of the item is hydrated
            const object = await result.items[0].getObject();
            expect(object).not.toBeNull();

            // @ts-ignore: We know that this is the correct type because of the above assertions
            const attribution = await object.getAttribution();
            expect(attribution).not.toBeNull();

            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(attribution.id).not.toBeNull();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(attribution.id.toString()).toEqual(actorId);
        });
    });

    describe('outboxDispatcher', () => {
        const outboxActivities: Record<string, object> = {
            'https://example.com/create/123': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                id: 'https://example.com/create/123',
                type: 'Create',
            },
            'https://example.com/announce/456': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                type: 'Announce',
                id: 'https://example.com/announce/456',
            },
            'https://example.com/accept/789': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                type: 'Accept',
                id: 'https://example.com/accept/789',
            },
            'https://example.com/like/987': {
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                ],
                type: 'Like',
                id: 'https://example.com/like/987',
            },
        };

        const ctx = {
            data: {
                db: {
                    get: vi.fn(),
                },
                globaldb: {
                    get: vi.fn(),
                },
                logger: {
                    info: vi.fn(),
                    error: vi.fn(),
                },
            },
        } as RequestContext<any>;

        beforeEach(() => {
            ctx.data.db.get.mockImplementation((key: string[]) => {
                return Promise.resolve(
                    key[0] === 'outbox'
                        ? Object.keys(outboxActivities)
                        : undefined,
                );
            });

            ctx.data.globaldb.get.mockImplementation((key: string[]) => {
                return Promise.resolve(outboxActivities[key[0]]);
            });

            if (!process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE) {
                process.env.ACTIVITYPUB_COLLECTION_PAGE_SIZE = '2';
            }
        });

        it('returns items from the outbox collection in the correct order', async () => {
            const result = await outboxDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                null,
            );

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct items are returned in the correct order
            expect(result.items.length).toEqual(2);
            expect(result.items[0] instanceof Activity).toBeTruthy();
            expect(result.items[1] instanceof Activity).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual(
                'https://example.com/announce/456',
            );
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[1].id.toString()).toEqual(
                'https://example.com/create/123',
            );
        });

        it('returns items from the outbox collection with a cursor', async () => {
            const result = await outboxDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                '1',
            );

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct items are returned
            expect(result.items.length).toEqual(1);
            expect(result.items[0] instanceof Activity).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual(
                'https://example.com/create/123',
            );
        });
    });

    describe('nodeInfoDispatcher', () => {
        it('returns the node info', async () => {
            const result = await nodeInfoDispatcher({} as RequestContext<any>);

            expect(result).toEqual({
                software: {
                    name: 'ghost',
                    version: { major: 0, minor: 1, patch: 0 },
                    homepage: new URL('https://ghost.org/'),
                    repository: new URL('https://github.com/TryGhost/Ghost'),
                },
                protocols: ['activitypub'],
                openRegistrations: false,
                usage: {
                    users: {},
                    localPosts: 0,
                    localComments: 0,
                },
            });
        });
    });
});
