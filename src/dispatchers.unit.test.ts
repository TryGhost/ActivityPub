import assert from 'assert';
import sinon from 'sinon';
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

            assert.equal(actual, expected);
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
                    get: sinon.stub(),
                },
                globaldb: {
                    get: sinon.stub(),
                },
            },
        } as RequestContext<any>;

        beforeEach(function () {
            ctx.data.db.get.withArgs(['outbox']).resolves(Object.keys(outboxActivities));

            Object.keys(outboxActivities).forEach(key => {
                ctx.data.globaldb.get.withArgs([key]).resolves(outboxActivities[key]);
            });
        });

        it('returns relevant items from the outbox in the correct order', async function () {
            const result = await outboxDispatcher(ctx);

            // Check items exist
            assert.ok(result.items);

            // Check correct items are returned in the correct order
            assert.equal(result.items.length, 2);
            assert.equal(result.items[0] instanceof Activity, true);
            assert.equal(result.items[1] instanceof Activity, true);
            assert.equal(result.items[0].id?.toString(), 'https://example.com/announce/456');
            assert.equal(result.items[1].id?.toString(), 'https://example.com/create/123');
        });
    });
});
