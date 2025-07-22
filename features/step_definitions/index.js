import fs from 'node:fs';
import { resolve } from 'node:path';

import {
    AfterAll,
    Before,
    BeforeAll,
    setDefaultTimeout,
} from '@cucumber/cucumber';
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
    ]);
});

BeforeAll(async function setupSelfSite() {
    const res = await fetchActivityPub('https://self.test/.ghost/activitypub/v1/site');
    const json = await res.json();

    await getClient()('sites')
        .update('webhook_secret', getWebhookSecret())
        .where('id', '=', json.id);

    this.SITE_ID = json.id;
});

BeforeAll(async function setupLocalSites() {
    await Promise.all([
        fetchActivityPub('https://alice.test/.ghost/activitypub/site'),
        fetchActivityPub('https://bob.test/.ghost/activitypub/site'),
        fetchActivityPub('https://carol.test/.ghost/activitypub/site'),
    ]);
});

Before(async function reset() {
    await resetWiremock();
    await resetDatabase();
    await Promise.all([
        fetchActivityPub('https://self.test/.ghost/activitypub/site'),
        fetchActivityPub('https://alice.test/.ghost/activitypub/site'),
        fetchActivityPub('https://bob.test/.ghost/activitypub/site'),
        fetchActivityPub('https://carol.test/.ghost/activitypub/site'),
    ]);
});

Before(async function setupState() {
    const res = await fetch('https://self.test/.ghost/activitypub/users/index');
    const actor = await res.json();

    this.activities = {};
    this.objects = {};
    this.actors = {
        Us: actor,
    };
    this.actors.Us.handle = '@index@self.test';
});
