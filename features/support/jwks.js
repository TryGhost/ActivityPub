import { createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import { resolve } from 'node:path';

import {
    calculateJwkThumbprint,
    exportJWK,
    generateKeyPair,
    importPKCS8,
    SignJWT,
} from 'jose';

import { getCurrentDirectory } from './path.js';
import { getGhostWiremock } from './wiremock.js';

export const FIXTURE_KEY_ID = 'test-key-id';

let fixtureKey;

/**
 * The key pair in `fixtures/private.key` that Ghost signs tokens with by
 * default in the tests
 */
export async function getFixtureKey() {
    if (!fixtureKey) {
        const privateKeyPem = fs.readFileSync(
            resolve(getCurrentDirectory(), '../fixtures/private.key'),
            'utf8',
        );

        fixtureKey = {
            kid: FIXTURE_KEY_ID,
            privateKey: await importPKCS8(privateKeyPem, 'RS256'),
            jwk: {
                ...createPublicKey(privateKeyPem).export({ format: 'jwk' }),
                kid: FIXTURE_KEY_ID,
            },
        };
    }

    return fixtureKey;
}

/**
 * Generate a new key pair, identified like Ghost's keys by its RFC 7638
 * thumbprint
 */
export async function createKey() {
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
        extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint(publicJwk);

    return {
        kid,
        privateKey,
        jwk: {
            ...publicJwk,
            kid,
            use: 'sig',
            alg: 'RS256',
        },
    };
}

/**
 * Sign a Ghost staff identity token. Pass `kid: null` to leave the `kid` out
 * of the token header.
 */
export async function signToken(key, { kid = key.kid } = {}) {
    const header = kid === null ? { alg: 'RS256' } : { alg: 'RS256', kid };

    return new SignJWT({ sub: 'test@user.com', role: 'Owner' })
        .setProtectedHeader(header)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key.privateKey);
}

export async function serveJwks(keys) {
    await getGhostWiremock().register(
        {
            method: 'GET',
            endpoint: '/ghost/.well-known/jwks.json',
        },
        {
            status: 200,
            body: {
                keys: keys.map((key) => key.jwk),
            },
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );
}
