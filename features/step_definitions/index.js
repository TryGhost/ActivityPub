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
    getGhostWiremock,
    reset as resetWiremock,
} from '../support/wiremock.js';

setDefaultTimeout(1000 * 10);

AfterAll(async () => {
    await getClient().destroy();
});

BeforeAll(async function setupWiremock() {
    const ghostActivityPub = getGhostWiremock();

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
                    site: {
                        title: 'Testing Blog',
                        description: 'A blog for testing',
                        icon: 'https://ghost.org/favicon.ico',
                        cover_image: 'https://ghost.org/cover.png',
                        site_uuid: "{{randomValue type='UUID'}}",
                    },
                },
                headers: {
                    'Content-Type': 'application/json',
                },
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
        fetchActivityPub('https://charlie.test/.ghost/activitypub/v1/site'),
    ]);
});

Before(async function setupState() {
    const [selfActor, aliceActor, bobActor, charlieActor] = await Promise.all([
        fetch('https://self.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
        fetch('https://alice.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
        fetch('https://bob.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
        fetch('https://charlie.test/.ghost/activitypub/users/index').then((r) =>
            r.json(),
        ),
    ]);

    const aliceWithHandle = { ...aliceActor, handle: '@index@alice.test' };
    const bobWithHandle = { ...bobActor, handle: '@index@bob.test' };
    const charlieWithHandle = {
        ...charlieActor,
        handle: '@index@charlie.test',
    };

    this.activities = {};
    this.objects = {};
    this.actors = {
        Us: { ...selfActor, handle: '@index@self.test' },
        'Alice.Internal': aliceWithHandle,
        'Bob.Internal': bobWithHandle,
        'Charlie.Internal': charlieWithHandle,
    };
});
