import { After, Given, When } from '@cucumber/cucumber';

import assert from 'node:assert';
import fs from 'node:fs';
import { resolve } from 'node:path';

import jwt from 'jsonwebtoken';
import jose from 'node-jose';

import { getCurrentDirectory } from '../support/path.js';
import { getGhostWiremock } from '../support/wiremock.js';

// Store key pairs for the test
let oldKeyPair;
let newKeyPair;

Given('the JWKS endpoint is serving an old key', async function () {
    const privateKeyPem = fs.readFileSync(
        resolve(getCurrentDirectory(), '../fixtures/private.key'),
        'utf8',
    );

    const oldKey = await jose.JWK.asKey(privateKeyPem, 'pem', {
        kid: 'test-key-id',
    });

    oldKeyPair = {
        publicKey: oldKey.toJSON(),
        privateKey: privateKeyPem,
    };

    const ghostActivityPub = getGhostWiremock();
    await ghostActivityPub.register(
        {
            method: 'GET',
            endpoint: '/ghost/.well-known/jwks.json',
        },
        {
            status: 200,
            body: {
                keys: [oldKeyPair.publicKey],
            },
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );

    this.oldKeyPair = oldKeyPair;
});

Given(
    'the old key has been cached by making a successful request',
    async function () {
        // Make a successful authenticated request to ensure the old key is cached
        const token = jwt.sign(
            {
                sub: 'test@user.com',
                role: 'Owner',
            },
            this.oldKeyPair.privateKey,
            {
                algorithm: 'RS256',
                keyid: 'test-key-id',
                expiresIn: '5m',
            },
        );

        const response = await fetch(
            'https://self.test/.ghost/activitypub/v1/account/me',
            {
                method: 'GET',
                headers: {
                    Accept: 'application/ld+json',
                    Authorization: `Bearer ${token}`,
                },
            },
        );

        assert(
            response.ok,
            'Initial request with old key should succeed to populate cache',
        );
    },
);

When('the JWKS endpoint is updated to serve a new key', async function () {
    const newKey = await jose.JWK.createKey('RSA', 2048, {
        kid: 'new-key-id',
        use: 'sig',
        alg: 'RS256',
    });

    newKeyPair = {
        publicKey: newKey.toJSON(),
        privateKey: newKey.toPEM(true), // true = private key
    };

    this.newKeyPair = newKeyPair;

    const ghostActivityPub = getGhostWiremock();
    await ghostActivityPub.register(
        {
            method: 'GET',
            endpoint: '/ghost/.well-known/jwks.json',
        },
        {
            status: 200,
            body: {
                keys: [this.newKeyPair.publicKey],
            },
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );
});

When(
    'an authenticated request is made with a token signed by the new key',
    async function () {
        // Create a token signed with the NEW key
        const token = jwt.sign(
            {
                sub: 'test@user.com',
                role: 'Owner',
            },
            this.newKeyPair.privateKey,
            {
                algorithm: 'RS256',
                keyid: 'new-key-id',
                expiresIn: '5m',
            },
        );

        // Make the request - this should trigger cache invalidation and retry
        // The middleware should:
        // 1. Fail to verify with cached old key
        // 2. Delete the cached key
        // 3. Refetch from JWKS endpoint (which now serves the new key)
        // 4. Retry verification with the new key
        // 5. Succeed and return 200
        this.response = await fetch(
            'https://self.test/.ghost/activitypub/v1/account/me',
            {
                method: 'GET',
                headers: {
                    Accept: 'application/ld+json',
                    Authorization: `Bearer ${token}`,
                },
            },
        );
    },
);

// Restore the original JWKS configuration after this test
After({ tags: '@jwks-cache-invalidation' }, async () => {
    const privateKeyPem = fs.readFileSync(
        resolve(getCurrentDirectory(), '../fixtures/private.key'),
        'utf8',
    );

    const key = await jose.JWK.asKey(privateKeyPem, 'pem', {
        kid: 'test-key-id',
    });
    const jwk = key.toJSON();

    const ghostActivityPub = getGhostWiremock();
    await ghostActivityPub.register(
        {
            method: 'GET',
            endpoint: '/ghost/.well-known/jwks.json',
        },
        {
            status: 200,
            body: {
                keys: [jwk],
            },
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );
});
