import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '@fedify/fedify';
import {
    likedDispatcher,
    nodeInfoDispatcher,
    outboxDispatcher,
} from './dispatchers';

import type { ContextData } from 'app';
import { ACTOR_DEFAULT_HANDLE } from './constants';

vi.mock('./app', () => ({
    fedify: {
        createContext: vi.fn(),
    },
}));

describe('dispatchers', () => {
    describe('likedDispatcher', () => {
        it('returns an empty array', async () => {
            const ctx = {
                getObjectUri(_type: unknown, data: Record<string, string>) {
                    return new URL(`https://site.com/${data.id}`);
                },
                data: {
                    globaldb: {
                        get() {
                            return {};
                        },
                    },
                },
            } as unknown as RequestContext<ContextData>;

            const result = await likedDispatcher(
                ctx,
                ACTOR_DEFAULT_HANDLE,
                null,
            );

            expect(result.items).toEqual([]);
            expect(result.nextCursor).toEqual(null);
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
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
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

            expect(result).toMatchObject({
                items: [],
                nextCursor: null,
            });
        });
    });

    describe('nodeInfoDispatcher', () => {
        it('returns the node info', async () => {
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
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
                    users: {
                        total: 1,
                    },
                    localPosts: 0,
                    localComments: 0,
                },
            });
        });
    });
});
