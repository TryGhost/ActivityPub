import {
    AfterAll,
    Before,
    BeforeAll,
    setDefaultTimeout,
} from '@cucumber/cucumber';

import fs from 'node:fs';
import { resolve } from 'node:path';

import jose from 'node-jose';

import { getClient, reset as resetDatabase } from '../support/db.js';
import { getWebhookSecret } from '../support/fixtures.js';
import { getCurrentDirectory } from '../support/path.js';
import { fetchActivityPub } from '../support/request.js';
import {
    getExternalWiremock,
    getGhostWiremock,
    reset as resetWiremock,
} from '../support/wiremock.js';

setDefaultTimeout(1000 * 10);

AfterAll(async () => {
    await getClient().destroy();
});

BeforeAll(async function setupWiremock() {
    const ghostActivityPub = getGhostWiremock();
    const externalActivityPub = getExternalWiremock();

    const publicKey = fs.readFileSync(
        resolve(getCurrentDirectory(), '../fixtures/private.key'),
        'utf8',
    );

    const key = await jose.JWK.asKey(publicKey, 'pem', {
        kid: 'test-key-id',
    });
    const jwk = key.toJSON();

    await Promise.all([
        ghostActivityPub.register(
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
                    'Content-Type': 'application/activity+json',
                },
            },
        ),
        ghostActivityPub.register(
            {
                method: 'GET',
                endpoint: '/ghost/api/admin/site/',
            },
            {
                status: 200,
                body: {
                    settings: {
                        site: {
                            title: 'Testing Blog',
                            icon: 'https://ghost.org/favicon.ico',
                            description: 'A blog for testing',
                        },
                    },
                },
                headers: {
                    'Content-Type': 'application/json',
                },
            },
        ),
        // Stub Ghost Explore actor on mastodon.social
        externalActivityPub.register(
            {
                method: 'GET',
                endpoint: '/users/ghostexplore',
            },
            {
                status: 200,
                body: {
                    '@context': [
                        'https://www.w3.org/ns/activitystreams',
                        'https://w3id.org/security/data-integrity/v1',
                    ],
                    id: 'https://mastodon.social/users/ghostexplore',
                    url: 'https://mastodon.social/@ghostexplore',
                    type: 'Service',
                    preferredUsername: 'ghostexplore',
                    name: 'Ghost Explore',
                    summary:
                        '<p>An aggregator of Ghost publications in the Fediverse</p>',
                    inbox: 'https://mastodon.social/users/ghostexplore/inbox',
                    outbox: 'https://mastodon.social/users/ghostexplore/outbox',
                    followers:
                        'https://mastodon.social/users/ghostexplore/followers',
                    following:
                        'https://mastodon.social/users/ghostexplore/following',
                    liked: 'https://mastodon.social/users/ghostexplore/liked',
                    'https://w3id.org/security#publicKey': {
                        id: 'https://mastodon.social/users/ghostexplore#main-key',
                        type: 'https://w3id.org/security#Key',
                        'https://w3id.org/security#owner': {
                            id: 'https://mastodon.social/users/ghostexplore',
                        },
                        'https://w3id.org/security#publicKeyPem':
                            '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n',
                    },
                },
                headers: {
                    'Content-Type': 'application/activity+json',
                },
            },
        ),
        externalActivityPub.register(
            {
                method: 'POST',
                endpoint: '/users/ghostexplore/inbox',
            },
            {
                status: 202,
            },
        ),
    ]);
});

async function setupSelfSite() {
    const res = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/site',
    );
    if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to fetch site: ${res.status} ${error}`);
    }

    const json = await res.json();

    await getClient()('sites')
        .update('webhook_secret', getWebhookSecret())
        .where('id', '=', json.id);
}

Before(async function reset() {
    await resetWiremock();
    await resetDatabase();
    await await Promise.all([
        setupSelfSite(),
        fetchActivityPub('https://alice.test/.ghost/activitypub/v1/site'),
        fetchActivityPub('https://bob.test/.ghost/activitypub/v1/site'),
        fetchActivityPub('https://carol.test/.ghost/activitypub/v1/site'),
    ]);
});

Before(async function setupState() {
    const [selfActor, aliceActor, bobActor, carolActor] = await Promise.all([
        fetch('https://self.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
        fetch('https://alice.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
        fetch('https://bob.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
        fetch('https://carol.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
    ]);

    const aliceWithHandle = { ...aliceActor, handle: '@index@alice.test' };
    const bobWithHandle = { ...bobActor, handle: '@index@bob.test' };
    const carolWithHandle = { ...carolActor, handle: '@index@carol.test' };

    this.activities = {};
    this.objects = {};
    this.actors = {
        Us: { ...selfActor, handle: '@index@self.test' },
        'Alice.Internal': aliceWithHandle,
        'Bob.Internal': bobWithHandle,
        'Carol.Internal': carolWithHandle,
    };
});
