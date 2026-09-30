import {
    createHash,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
} from 'node:crypto';
import fs from 'node:fs';
import { resolve } from 'node:path';

import jwt from 'jsonwebtoken';

import { getCurrentDirectory } from './path.js';
import { getGhostWiremock } from './wiremock.js';

export const FIXTURE_KEY_ID = 'test-key-id';

let fixtureKey;

/**
 * The key pair in `fixtures/private.key` that Ghost signs tokens with by
 * default in the tests. It is a 1024-bit key, like the keys of sites that
 * haven't rotated their signing key yet.
 */
export async function getFixtureKey() {
    if (!fixtureKey) {
        const privateKeyPem = fs.readFileSync(
            resolve(getCurrentDirectory(), '../fixtures/private.key'),
            'utf8',
        );

        fixtureKey = {
            kid: FIXTURE_KEY_ID,
            privateKey: createPrivateKey(privateKeyPem),
            jwk: {
                ...createPublicKey(privateKeyPem).export({ format: 'jwk' }),
                kid: FIXTURE_KEY_ID,
            },
        };
    }

    return fixtureKey;
}

/**
 * Generate a new 2048-bit key pair, identified like Ghost's keys by its
 * RFC 7638 thumbprint
 */
export async function createKey() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });
    const { e, kty, n } = publicKey.export({ format: 'jwk' });
    const kid = createHash('sha256')
        .update(JSON.stringify({ e, kty, n }))
        .digest('base64url');

    return {
        kid,
        privateKey,
        jwk: {
            e,
            kty,
            n,
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
    return jwt.sign({ sub: 'test@user.com', role: 'Owner' }, key.privateKey, {
        algorithm: 'RS256',
        expiresIn: '5m',
        // jsonwebtoken refuses to sign with keys smaller than 2048 bits
        allowInsecureKeySizes: true,
        ...(kid === null ? {} : { keyid: kid }),
    });
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
