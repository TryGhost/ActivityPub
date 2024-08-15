import { Image, RequestContext } from '@fedify/fedify';
import assert from 'assert';
import sinon from 'sinon';

import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY
} from './constants';
import { getUserData } from './user';

const HANDLE = 'foo';
const ACTOR_URI = `https://example.com/${HANDLE}`;
const INBOX_URI = `https://example.com/${HANDLE}/inbox`;
const OUTBOX_URI = `https://example.com/${HANDLE}/outbox`;
const FOLLOWING_URI = `https://example.com/${HANDLE}/following`;
const FOLLOWERS_URI = `https://example.com/${HANDLE}/followers`;

function getCtx() {
    const host = 'example.com';

    const ctx = {
        data: {
            db: {
                get: sinon.stub(),
                set: sinon.stub(),
            },
        },
        getActorKeyPairs: sinon.stub(),
        getActorUri: sinon.stub(),
        getInboxUri: sinon.stub(),
        getOutboxUri: sinon.stub(),
        getFollowingUri: sinon.stub(),
        getFollowersUri: sinon.stub(),
        host,
    };

    ctx.getActorKeyPairs.withArgs(HANDLE).resolves([
        { cryptographicKey: 'abc123' }
    ]);

    ctx.getActorUri.withArgs(HANDLE).returns(new URL(ACTOR_URI));
    ctx.getInboxUri.withArgs(HANDLE).returns(new URL(INBOX_URI));
    ctx.getOutboxUri.withArgs(HANDLE).returns(new URL(OUTBOX_URI));
    ctx.getFollowingUri.withArgs(HANDLE).returns(new URL(FOLLOWING_URI));
    ctx.getFollowersUri.withArgs(HANDLE).returns(new URL(FOLLOWERS_URI));

    return ctx as any;
}

describe('getUserData', function () {
    it('persists a user to the database if it does not exist', async function () {
        const ctx = getCtx();

        ctx.data.db.get.resolves(null);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: ACTOR_DEFAULT_NAME,
            summary: ACTOR_DEFAULT_SUMMARY,
            preferredUsername: HANDLE,
            icon: new Image({ url: new URL(ACTOR_DEFAULT_ICON) }),
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: new URL(`https://${ctx.host}`),
        }

        assert.ok(
            ctx.data.db.set.calledOnceWith(['handle', HANDLE], {
                id: expectedUserData.id.href,
                name: expectedUserData.name,
                summary: expectedUserData.summary,
                preferredUsername: expectedUserData.preferredUsername,
                icon: ACTOR_DEFAULT_ICON,
                inbox: expectedUserData.inbox.href,
                outbox: expectedUserData.outbox.href,
                following: expectedUserData.following.href,
                followers: expectedUserData.followers.href,
                url: expectedUserData.url.href,
            })
        );
        assert.deepStrictEqual(result, expectedUserData);
    });

    it('retrieves a user from the database', async function () {
        const ctx = getCtx();

        const persistedUser = {
            id: `https://${ctx.host}/${HANDLE}`,
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: `https://${ctx.host}/icon.png`,
            inbox: INBOX_URI,
            outbox: OUTBOX_URI,
            following: FOLLOWING_URI,
            followers: FOLLOWERS_URI,
            url: `https://${ctx.host}`,
        }

        ctx.data.db.get.resolves(persistedUser);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: new Image({ url: new URL(`https://${ctx.host}/icon.png`) }),
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: new URL(`https://${ctx.host}`),
        }

        assert.ok(ctx.data.db.set.notCalled);
        assert.deepStrictEqual(result, expectedUserData);
    });

    it('handles retrieving a user with an invalid icon', async function () {
        const ctx = getCtx();

        const persistedUser = {
            id: `https://${ctx.host}/${HANDLE}`,
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            inbox: INBOX_URI,
            outbox: OUTBOX_URI,
            following: FOLLOWING_URI,
            followers: FOLLOWERS_URI,
            url: `https://${ctx.host}`,
        }

        ctx.data.db.get.resolves(persistedUser);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: null,
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: new URL(`https://${ctx.host}`),
        }

        assert.ok(ctx.data.db.set.notCalled);
        assert.deepStrictEqual(result, expectedUserData);
    });

    it('handles retrieving a user with an invalid URL', async function () {
        const ctx = getCtx();

        const persistedUser = {
            id: `https://${ctx.host}/${HANDLE}`,
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: `https://${ctx.host}/icon.png`,
            inbox: INBOX_URI,
            outbox: OUTBOX_URI,
            following: FOLLOWING_URI,
            followers: FOLLOWERS_URI
        }

        ctx.data.db.get.resolves(persistedUser);

        const result = await getUserData(ctx, HANDLE);

        const expectedUserData = {
            id: new URL(`https://${ctx.host}/${HANDLE}`),
            name: 'foo',
            summary: 'bar',
            preferredUsername: HANDLE,
            icon: new Image({ url: new URL(`https://${ctx.host}/icon.png`) }),
            inbox: new URL(INBOX_URI),
            outbox: new URL(OUTBOX_URI),
            following: new URL(FOLLOWING_URI),
            followers: new URL(FOLLOWERS_URI),
            publicKeys: ['abc123'],
            url: null,
        }

        assert.ok(ctx.data.db.set.notCalled);
        assert.deepStrictEqual(result, expectedUserData);
    });
});
