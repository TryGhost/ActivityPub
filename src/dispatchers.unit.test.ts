import assert from 'assert';
import { RequestContext } from '@fedify/fedify';
import { ContextData } from './app';
import { actorDispatcher } from './dispatchers';

describe('dispatchers', function () {
    describe('actorDispatcher', function () {
        it('returns null if the handle is not "index"', async function () {
            const ctx = {} as RequestContext<ContextData>;
            const handle = 'anything';

            const actual = await actorDispatcher(ctx, handle);
            const expected = null;

            assert.equal(actual, expected);
        });
    });
    describe('keypairDispatcher', function () {});
    describe('handleFollow', function () {});
});
