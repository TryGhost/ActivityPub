import { After, Given, When } from '@cucumber/cucumber';

import assert from 'node:assert';

import {
    createKey,
    getFixtureKey,
    serveJwks,
    signToken,
} from '../support/jwks.js';

const ACCOUNT_URL = 'https://self.test/.ghost/activitypub/v1/account/me';

function requestWithToken(token) {
    return fetch(ACCOUNT_URL, {
        method: 'GET',
        headers: {
            Accept: 'application/ld+json',
            Authorization: `Bearer ${token}`,
        },
    });
}

async function getNewKey(world) {
    if (!world.newKey) {
        world.newKey = await createKey();
    }

    return world.newKey;
}

Given('the JWKS endpoint is serving the current key', async () => {
    await serveJwks([await getFixtureKey()]);
});

Given(
    'the JWKS endpoint is serving the current key and a new key',
    async function () {
        await serveJwks([await getFixtureKey(), await getNewKey(this)]);
    },
);

Given(
    'the current key has been cached by making a successful request',
    async () => {
        const response = await requestWithToken(
            await signToken(await getFixtureKey()),
        );

        assert(
            response.ok,
            'Initial request with the current key should succeed to populate the cache',
        );
    },
);

Given(
    'the new key has been cached by making a successful request',
    async function () {
        // A token with a kid missing from the cached key set makes us
        // refetch it, whereas a token without a kid never does
        const response = await requestWithToken(
            await signToken(await getNewKey(this)),
        );

        assert(
            response.ok,
            'Request with the new key should succeed to populate the cache',
        );
    },
);

When(
    'the JWKS endpoint is updated to serve a new key alongside the current key',
    async function () {
        // Ghost lists the key it is signing with first
        await serveJwks([await getNewKey(this), await getFixtureKey()]);
    },
);

When(
    'an authenticated request is made with a token signed by the new key',
    async function () {
        this.response = await requestWithToken(
            await signToken(await getNewKey(this)),
        );
    },
);

When(
    'an authenticated request is made with a token signed by the new key without a kid',
    async function () {
        this.response = await requestWithToken(
            await signToken(await getNewKey(this), { kid: null }),
        );
    },
);

When(
    'an authenticated request is made with a token signed by an unknown key',
    async function () {
        this.response = await requestWithToken(
            await signToken(await createKey()),
        );
    },
);

// Restore the original JWKS configuration after this test
After({ tags: '@jwks-cache-invalidation' }, async () => {
    await serveJwks([await getFixtureKey()]);
});
