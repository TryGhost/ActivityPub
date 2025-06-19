import fs from 'node:fs';
import { resolve } from 'node:path';

import {
    AfterAll,
    Before,
    BeforeAll,
    setDefaultTimeout,
} from '@cucumber/cucumber';
import { exportJwk, generateCryptoKeyPair } from '@fedify/fedify';
import jose from 'node-jose';

import { getClient, reset as resetDatabase } from '../support/db.js';
import { createActor, getWebhookSecret } from '../support/fixtures.js';
import { getCurrentDirectory } from '../support/path.js';
import {
    getGhostActivityPub,
    reset as resetWiremock,
} from '../support/wiremock.js';

setDefaultTimeout(1000 * 10);

BeforeAll(async () => {
    const ghostActivityPub = getGhostActivityPub();

    const publicKey = fs.readFileSync(
        resolve(getCurrentDirectory(), '../fixtures/private.key'),
        'utf8',
    );

    const key = await jose.JWK.asKey(publicKey, 'pem', {
        kid: 'test-key-id',
    });
    const jwk = key.toJSON();

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
    );

    ghostActivityPub.register(
        {
            method: 'GET',
            endpoint: '/ghost/api/admin/site',
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
    );
});

AfterAll(async () => {
    await getClient().destroy();
});

Before(async function () {
    await resetWiremock();
    await resetDatabase();

    const [siteId] = await getClient()('sites').insert({
        host: new URL(process.env.URL_GHOST_ACTIVITY_PUB).host,
        webhook_secret: getWebhookSecret(),
    });

    this.SITE_ID = siteId;
});

Before(async function () {
    if (!this.activities) {
        this.activities = {};
    }
    if (!this.objects) {
        this.objects = {};
    }
    if (!this.actors) {
        const actor = await createActor('Test', { remote: false });

        const keypair = await generateCryptoKeyPair();

        const [accountId] = await getClient()('accounts').insert({
            username: actor.preferredUsername,
            name: actor.name,
            bio: actor.summary,
            avatar_url: null,
            banner_image_url: null,
            url: actor.url,
            custom_fields: null,
            ap_id: actor.id,
            ap_inbox_url: actor.inbox,
            ap_shared_inbox_url: null,
            ap_outbox_url: actor.outbox,
            ap_following_url: actor.following,
            ap_followers_url: actor.followers,
            ap_liked_url: actor.liked,
            ap_public_key: JSON.stringify(await exportJwk(keypair.publicKey)),
            ap_private_key: JSON.stringify(await exportJwk(keypair.privateKey)),
            domain: new URL(actor.id).host,
        });

        await getClient()('users').insert({
            account_id: accountId,
            site_id: this.SITE_ID,
        });

        this.actors = {
            Us: actor,
        };
    }
});
