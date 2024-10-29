import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    actorDispatcher,
    outboxDispatcher,
} from './dispatchers';
import { Activity, RequestContext } from '@fedify/fedify';
import { ACTOR_DEFAULT_HANDLE } from './constants';

describe('dispatchers', function () {
    describe('actorDispatcher', function () {
        it(`returns null if the handle is not "${ACTOR_DEFAULT_HANDLE}"`, async function () {
            const ctx = {} as RequestContext<any>;
            const handle = 'anything';

            const actual = await actorDispatcher(ctx, handle);
            const expected = null;

            expect(actual).toEqual(expected);
        });
    });

    describe('outboxDispatcher', function () {
        const outboxActivities: Record<string, any> = {
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

        beforeEach(function () {
            ctx.data.db.get.mockImplementation((key: string[]) => {
                return Promise.resolve(
                    key[0] === 'outbox'
                        ? Object.keys(outboxActivities)
                        : undefined
                );
            });

            ctx.data.globaldb.get.mockImplementation((key: string[]) => {
                return Promise.resolve(outboxActivities[key[0]]);
            });
        });

        it('returns relevant items from the outbox in the correct order', async function () {
            const result = await outboxDispatcher(ctx, ACTOR_DEFAULT_HANDLE);

            // Check items exist
            expect(result.items).toBeDefined();

            // Check correct items are returned in the correct order
            expect(result.items.length).toEqual(2);
            expect(result.items[0] instanceof Activity).toBeTruthy();
            expect(result.items[1] instanceof Activity).toBeTruthy();
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[0].id.toString()).toEqual('https://example.com/announce/456');
            // @ts-ignore: We know that this is the correct type because of the above assertions
            expect(result.items[1].id.toString()).toEqual('https://example.com/create/123');
        });
    });
});
