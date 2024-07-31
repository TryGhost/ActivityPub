import assert from 'assert';
import {
    actorDispatcher,
    keypairDispatcher,
    handleFollow,
    inboxErrorHandler,
    handleAccept,
    handleCreate,
    followersDispatcher,
    followersCounter,
    followingDispatcher,
    followingCounter,
    outboxDispatcher,
    outboxCounter,
    articleDispatcher,
    noteDispatcher,
    followDispatcher,
    acceptDispatcher,
    createDispatcher,
} from './dispatchers';
import { RequestContext } from '@fedify/fedify';
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
    describe('keypairDispatcher', function () {});
    describe('handleFollow', function () {});
});
