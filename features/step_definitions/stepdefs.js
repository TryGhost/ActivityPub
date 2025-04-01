import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AfterAll,
    Before,
    BeforeAll,
    Given,
    Then,
    When,
} from '@cucumber/cucumber';
import { exportJwk, generateCryptoKeyPair } from '@fedify/fedify';
import { merge } from 'es-toolkit';
import jwt from 'jsonwebtoken';
import Knex from 'knex';
import jose from 'node-jose';
import { v4 as uuidv4 } from 'uuid';
import { WireMock } from 'wiremock-captain';

// Get the current file's URL and convert it to a path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const URL_EXTERNAL_ACTIVITY_PUB = 'http://fake-external-activitypub';
const URL_GHOST_ACTIVITY_PUB = 'http://fake-ghost-activitypub';

async function createActivity(type, object, actor) {
    let activity;

    if (type === 'Follow') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Follow',
            id: `${URL_EXTERNAL_ACTIVITY_PUB}/follow/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Accept') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Accept',
            id: `${URL_EXTERNAL_ACTIVITY_PUB}/accept/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Create') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Create',
            id: `${URL_EXTERNAL_ACTIVITY_PUB}/create/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Announce') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Announce',
            id: `${URL_EXTERNAL_ACTIVITY_PUB}/announce/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Like') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Like',
            id: `${URL_EXTERNAL_ACTIVITY_PUB}/like/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Undo') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Undo',
            id: `${URL_EXTERNAL_ACTIVITY_PUB}/undo/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    if (type === 'Delete') {
        activity = {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Delete',
            id: `${URL_EXTERNAL_ACTIVITY_PUB}/delete/${uuidv4()}`,
            to: 'as:Public',
            object: object,
            actor: actor,
        };
    }

    externalActivityPub.register(
        {
            method: 'GET',
            endpoint: activity.id.replace(URL_EXTERNAL_ACTIVITY_PUB, ''),
        },
        {
            status: 200,
            body: activity,
            headers: {
                'Content-Type': 'application/activity+json',
            },
        },
    );

    return activity;
}

async function createActor(name, { remote = true, type = 'Person' } = {}) {
    if (remote === false) {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            id: 'http://fake-ghost-activitypub/.ghost/activitypub/users/index',
            url: 'http://fake-ghost-activitypub/.ghost/activitypub/users/index',
            type,

            handle: '@index@fake-ghost-activitypub',

            preferredUsername: 'index',
            name,
            summary: 'A test actor for testing',

            inbox: 'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
            outbox: 'http://fake-ghost-activitypub/.ghost/activitypub/outbox/index',
            followers:
                'http://fake-ghost-activitypub/.ghost/activitypub/followers/index',
            following:
                'http://fake-ghost-activitypub/.ghost/activitypub/following/index',
            liked: 'http://fake-ghost-activitypub/.ghost/activitypub/liked/index',

            'https://w3id.org/security#publicKey': {
                id: 'http://fake-ghost-activitypub/.ghost/activitypub/users/index#main-key',
                type: 'https://w3id.org/security#Key',
                'https://w3id.org/security#owner': {
                    id: 'http://fake-ghost-activitypub/.ghost/activitypub/users/index',
                },
                'https://w3id.org/security#publicKeyPem':
                    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n',
            },
        };
    }

    const user = {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/data-integrity/v1',
        ],
        id: `http://fake-external-activitypub/user/${name}`,
        url: `http://fake-external-activitypub/user/${name}`,
        type,

        handle: `@${name}@fake-external-activitypub`,

        preferredUsername: name,
        name,
        summary: 'A test actor for testing',

        inbox: `http://fake-external-activitypub/inbox/${name}`,
        outbox: `http://fake-external-activitypub/inbox/${name}`,
        followers: `http://fake-external-activitypub/followers/${name}`,
        following: `http://fake-external-activitypub/following/${name}`,
        liked: `http://fake-external-activitypub/liked/${name}`,

        'https://w3id.org/security#publicKey': {
            id: 'http://fake-external-activitypub/user#main-key',
            type: 'https://w3id.org/security#Key',
            'https://w3id.org/security#owner': {
                id: 'http://fake-external-activitypub/user',
            },
            'https://w3id.org/security#publicKeyPem':
                '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n',
        },
    };

    externalActivityPub.register(
        {
            method: 'POST',
            endpoint: `/inbox/${name}`,
        },
        {
            status: 202,
        },
    );

    externalActivityPub.register(
        {
            method: 'GET',
            endpoint: `/user/${name}`,
        },
        {
            status: 200,
            body: user,
            headers: {
                'Content-Type': 'application/activity+json',
            },
        },
    );

    externalActivityPub.register(
        {
            method: 'GET',
            endpoint: `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${name}@fake-external-activitypub`)}`,
        },
        {
            status: 200,
            body: {
                subject: `acct:${name}@fake-external-activitypub`,
                aliases: [`http://fake-external-activitypub/user/${name}`],
                links: [
                    {
                        rel: 'self',
                        href: `http://fake-external-activitypub/user/${name}`,
                        type: 'application/activity+json',
                    },
                    {
                        rel: 'http://webfinger.net/rel/profile-page',
                        href: 'https://activitypub.ghost.org/',
                    },
                    {
                        rel: 'http://webfinger.net/rel/avatar',
                        href: 'https://activitypub.ghost.org/content/images/2024/09/ghost-orb-white-squircle-07.png',
                    },
                ],
            },
        },
    );

    return user;
}

function generateObject(type, content) {
    if (type === 'Article') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Article',
            id: `http://fake-external-activitypub/article/${uuid}`,
            url: `http://fake-external-activitypub/article/${uuid}`,
            to: 'as:Public',
            cc: 'http://fake-external-activitypub/followers',
            content: content ?? '<p>This is a test article</p>',
            published: new Date(),
            attributedTo: 'http://fake-external-activitypub/user',
        };
    }

    if (type === 'Note') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Note',
            id: `http://fake-external-activitypub/note/${uuid}`,
            url: `http://fake-external-activitypub/note/${uuid}`,
            to: 'as:Public',
            cc: 'http://fake-external-activitypub/followers',
            content: content ?? '<p>This is a test note</p>',
            published: new Date(),
            attributedTo: 'http://fake-external-activitypub/user',
        };
    }

    if (type === 'Accept') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            type: 'Accept',
            id: `http://fake-external-activitypub/accept/${uuid}`,
            url: `http://fake-external-activitypub/accept/${uuid}`,
        };
    }
}

async function createObject(type, actor, content) {
    const object = generateObject(type, content);

    if (!object) {
        throw new Error(`Cannot create objects of type ${type}`);
    }

    object.attributedTo = actor.id;

    const url = new URL(object.id);

    externalActivityPub.register(
        {
            method: 'GET',
            endpoint: url.pathname,
        },
        {
            status: 200,
            body: object,
            headers: {
                'Content-Type': 'application/activity+json',
            },
        },
    );

    return object;
}

function createWebhookPost() {
    const uuid = uuidv4();

    return {
        post: {
            current: {
                uuid,
                title: 'Test Post',
                html: '<p>This is a test post</p>',
                excerpt: 'This is a test post',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: `http://fake-external-activitypub/post/${uuid}`,
                visibility: 'public',
            },
        },
    };
}

/**
 *
 * Splits a string like `Create(Note)` or `Like(A)` into its activity and object parts
 *
 * @param {string} string
 * @returns {{activity: string, object: string} | {activity: null, object: null}}
 */
function parseActivityString(string) {
    const [match, activity, object] = string.match(/(\w+)\((.+)\)/) || [null];
    if (!match) {
        return {
            activity: null,
            object: null,
        };
    }
    return {
        activity,
        object,
    };
}

/**
 *
 * Splits a string like `Person(Alice)` or `Group(Wonderland)` into its type and name parts
 *
 * @param {string} string
 * @returns {{type: string, name: string} | {type: null, name: null}}
 */
function parseActorString(string) {
    const [match, type, name] = string.match(/(\w+)\((.+)\)/) || [null];
    if (!match) {
        return {
            type: null,
            name: null,
        };
    }
    return {
        type,
        name,
    };
}

let /* @type Knex */ client;
let /* @type WireMock */ externalActivityPub;
let /* @type WireMock */ ghostActivityPub;
let webhookSecret;

BeforeAll(async () => {
    client = Knex({
        client: 'mysql2',
        connection: {
            host: process.env.MYSQL_HOST,
            port: Number.parseInt(process.env.MYSQL_PORT),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            timezone: '+00:00',
        },
    });

    await client.raw('SET FOREIGN_KEY_CHECKS = 0');
    await client('key_value').truncate();
    await client('follows').truncate();
    await client('accounts').truncate();
    await client('users').truncate();
    await client('sites').truncate();
    await client.raw('SET FOREIGN_KEY_CHECKS = 1');

    webhookSecret = fs.readFileSync(
        resolve(__dirname, '../fixtures/webhook_secret.txt'),
        'utf8',
    );
});

BeforeAll(async () => {
    externalActivityPub = new WireMock(URL_EXTERNAL_ACTIVITY_PUB);
    ghostActivityPub = new WireMock(URL_GHOST_ACTIVITY_PUB);

    const publicKey = fs.readFileSync(
        resolve(__dirname, '../fixtures/private.key'),
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
    await client.destroy();
});

Before(async function () {
    await externalActivityPub.clearAllRequests();
    await client.raw('SET FOREIGN_KEY_CHECKS = 0');
    await client('key_value').truncate();
    await client('follows').truncate();
    await client('users').truncate();
    await client('accounts').truncate();
    await client('sites').truncate();
    await client.raw('SET FOREIGN_KEY_CHECKS = 1');

    const [siteId] = await client('sites').insert({
        host: new URL(URL_GHOST_ACTIVITY_PUB).host,
        webhook_secret: webhookSecret,
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

        const [accountId] = await client('accounts').insert({
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
        });

        await client('users').insert({
            account_id: accountId,
            site_id: this.SITE_ID,
        });

        this.actors = {
            Us: actor,
        };
    }
});

async function fetchActivityPub(url, options = {}, auth = true) {
    if (!options.headers) {
        options.headers = {};
    }

    const privateKey = fs.readFileSync(
        resolve(__dirname, '../fixtures/private.key'),
    );
    const token = jwt.sign(
        {
            sub: 'test@user.com',
            role: 'Owner',
        },
        privateKey,
        {
            algorithm: 'RS256',
            keyid: 'test-key-id',
            expiresIn: '5m',
        },
    );

    if (auth) {
        options.headers.Authorization = `Bearer ${token}`;
    }

    return fetch(url, options);
}

Given('there is no entry in the sites table', async function () {
    await client('sites').del();

    this.SITE_ID = null;
});

When('we request the outbox', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/outbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

When(
    /an authenticated (\"(delete|get|post|put)\"\s)?request is made to "(.*)"/,
    async function (method, path) {
        const requestMethod = method || 'get';
        let requestPath = path;

        // If this is a request to the /thread/ or delete post endpoint, we need to replace the
        // object name with the object ID as we don't have a way to know the object
        // ID ahead of time
        if (
            path.includes('/thread/') ||
            (requestMethod === 'delete' && path.includes('/post/'))
        ) {
            const objectName = path.split('/').pop(); // Object name is the last part of the path

            const object =
                this.objects[objectName] || this.activities[objectName]?.object;

            if (object) {
                requestPath = path.replace(
                    objectName,
                    encodeURIComponent(object.id),
                );
            }
        }

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub${requestPath}`,
            {
                method: requestMethod,
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
    },
);

When('an unauthenticated request is made to {string}', async function (path) {
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub${path}`,
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
        false,
    );
});

When('we request the site endpoint', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/site',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

Given('an Actor {string}', async function (actorDef) {
    const { type, name } = parseActorString(actorDef);

    if (!type) {
        throw new Error(`could not match ${actorDef} to an actor`);
    }

    if (!name) {
        throw new Error('could not match name');
    }

    this.actors[name] = await createActor(name, { type });
});

async function getActor(input) {
    const existingActor = this.actors[input];

    let type = 'Person';
    let name = input;

    if (!existingActor) {
        const parsed = parseActorString(input);
        if (parsed.type && parsed.name) {
            type = parsed.type;
            name = parsed.name;
        }
        this.actors[name] = await createActor(name, { type });
    }

    return {
        type,
        name,
        actor: this.actors[name],
    };
}

Given('we are following {string}', async function (input) {
    const { actor } = await getActor.call(this, input);

    const followResponse = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/follow/${actor.handle}`,
        {
            method: 'POST',
        },
    );

    if (!followResponse.ok) {
        throw new Error('Something went wrong');
    }

    const follow = await createActivity('Follow', actor, this.actors.Us);

    const accept = await createActivity('Accept', follow, actor);

    const acceptResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ld+json',
            },
            body: JSON.stringify(accept),
        },
    );

    if (!acceptResponse.ok) {
        throw new Error('Something went wrong');
    }

    await waitForInboxActivity(accept);
});

Given('we follow {string}', async function (name) {
    const handle = this.actors[name].handle;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/follow/${handle}`,
        {
            method: 'POST',
        },
    );
    if (this.response.ok) {
        this.activities[`Follow(${name})`] = await createActivity(
            'Follow',
            this.actors[name],
            this.actors.Us,
        );
    }
});

Given('we unfollow {string}', async function (name) {
    const handle = this.actors[name].handle;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/unfollow/${handle}`,
        {
            method: 'POST',
        },
    );
    if (this.response.ok) {
        this.activities[`Unfollow(${name})`] = await this.response
            .clone()
            .json();
    }
});

async function weAreFollowedBy(actor) {
    const object = this.actors.Us;
    const activity = await createActivity('Follow', object, actor);

    // Send the follow activity to the inbox
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            body: JSON.stringify(activity),
        },
    );

    if (!response.ok) {
        throw new Error('Something went wrong');
    }

    await waitForInboxActivity(activity);
}

Given('we are followed by {string}', async function (input) {
    const { actor } = await getActor.call(this, input);
    await weAreFollowedBy.call(this, actor);
});

Given('we are followed by:', async function (actors) {
    for (const { name, type } of actors.hashes()) {
        // Create the actor
        this.actors[name] = await createActor(name, { type });

        await weAreFollowedBy.call(this, this.actors[name]);
    }
});

When('we like the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/like/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

When('we unlike the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/unlike/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should be liked', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const object = this.objects[name];

    const found = inbox.items.find((item) => item.object.id === object.id);

    assert(found.object.liked === true);
});

Then('the object {string} should not be liked', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const object = this.objects[name];

    const found = inbox.items.find((item) => item.object.id === object.id);

    assert(found.object.liked !== true);
});

When('we repost the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/repost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should be reposted', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const object = this.objects[name];

    const found = inbox.items.find((item) => item.object.id === object.id);

    assert(found.object.reposted === true);
});

Then(
    'the object {string} should have a repost count of {int}',
    async function (name, repostCount) {
        const response = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        const inbox = await response.json();
        const object = this.objects[name];

        const found = inbox.items.find((item) => item.object.id === object.id);

        assert(found.object.repostCount === repostCount);
    },
);

When('we undo the repost of the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/derepost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should not be reposted', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const object = this.objects[name];
    const found = inbox.items.find((item) => item.object.id === object.id);

    assert(found.object.reposted !== true);
});

async function getObjectInCollection(objectName, collectionType) {
    const initialResponse = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/${collectionType}/index`,
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const initialResponseJson = await initialResponse.json();

    let collection = initialResponseJson;

    if (initialResponseJson.first) {
        const firstPageReponse = await fetchActivityPub(
            initialResponseJson.first,
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        collection = await firstPageReponse.json();
    }

    const object = this.objects[objectName] || this.actors[objectName];

    return (collection.orderedItems || []).find((item) => {
        let id;
        const itemIsString = typeof item === 'string';
        if (itemIsString) {
            id = item;
        } else if (collectionType === 'liked') {
            id = item.object.id;
        } else {
            id = item.id;
        }

        return id === object.id;
    });
}

Then(
    'the object {string} should be in the {string} collection',
    async function (name, collectionType) {
        const objectInCollection = await getObjectInCollection.call(
            this,
            name,
            collectionType,
        );

        assert(objectInCollection);
    },
);

Then(
    'the object {string} should not be in the {string} collection',
    async function (name, collectionType) {
        const objectInCollection = await getObjectInCollection.call(
            this,
            name,
            collectionType,
        );

        assert(!objectInCollection);
    },
);

Given(
    'a {string} Object {string} by {string}',
    async function (objectType, objectName, actorName) {
        const actor = this.actors[actorName];
        const object = await createObject(objectType, actor);

        this.objects[objectName] = object;
    },
);

Given('{string} is a reply to {string}', async function (objectA, objectB) {
    this.objects[objectA].inReplyTo = this.objects[objectB].id;
});

async function activityCreatedBy(activityDef, name, actorName) {
    const { activity: activityType, object: objectName } =
        parseActivityString(activityDef);
    if (!activityType) {
        throw new Error(`could not match ${activityDef} to an activity`);
    }

    const actor = this.actors[actorName];
    const object =
        this.actors[objectName] ??
        this.activities[objectName] ??
        this.objects[objectName] ??
        (await createObject(objectName, actor));

    const activity = await createActivity(activityType, object, actor);

    const parsed = parseActivityString(name);
    if (parsed.activity === null || parsed.object === null) {
        this.activities[name] = activity;
        this.objects[name] = object;
    } else {
        this.activities[parsed.activity] = activity;
        this.objects[parsed.object] = object;
    }
}

async function activityCreatedByWithContent(
    activityDef,
    name,
    actorName,
    content,
) {
    const { activity: activityType, object: objectName } =
        parseActivityString(activityDef);
    if (!activityType) {
        throw new Error(`could not match ${activityDef} to an activity`);
    }

    const actor = this.actors[actorName];
    const object =
        this.actors[objectName] ??
        this.activities[objectName] ??
        this.objects[objectName] ??
        (await createObject(objectName, actor, content));

    const activity = await createActivity(activityType, object, actor);

    const parsed = parseActivityString(name);
    if (parsed.activity === null || parsed.object === null) {
        this.activities[name] = activity;
        this.objects[name] = object;
    } else {
        this.activities[parsed.activity] = activity;
        this.objects[parsed.object] = object;
    }
}

Given('a {string} Activity {string} by {string}', activityCreatedBy);

Given(
    'a {string} Activity {string} by {string} with content {string}',
    activityCreatedByWithContent,
);

Given(
    'an {string} Activity {string} is created by {string}',
    activityCreatedBy,
);

When(
    '{string} sends {string} to the Inbox',
    async function (actorName, activityName) {
        if (!this.actors[actorName]) {
            throw new Error(`Could not find Actor ${actorName}`);
        }
        if (!this.activities[activityName]) {
            throw new Error(`Could not find Activity ${activityName}`);
        }

        const activity = this.activities[activityName];

        this.response = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/ld+json',
                },
                body: JSON.stringify(activity),
            },
        );
    },
);

async function wait(n) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

async function waitForRequest(
    method,
    path,
    matcher,
    step = 100,
    milliseconds = 1000,
) {
    const calls = await externalActivityPub.getRequestsForAPI(method, path);
    const found = calls.find(matcher);

    if (found) {
        return found;
    }

    if (milliseconds <= 0) {
        return null;
    }

    await wait(step);
    return waitForRequest(method, path, matcher, step, milliseconds - step);
}

async function waitForInboxActivity(
    activity,
    object = null,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();

    if (
        inbox.items.find((item) => {
            const activityFound = item.id === activity.id;

            if (object) {
                return activityFound && item.object.id === object.id;
            }

            return activityFound;
        })
    ) {
        return;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting on an activity in the inbox`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    await waitForInboxActivity(activity, object, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

async function findInOutbox(activity) {
    const initialResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/outbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const initialResponseJson = await initialResponse.json();
    const firstPageReponse = await fetchActivityPub(initialResponseJson.first, {
        headers: {
            Accept: 'application/ld+json',
        },
    });
    const outbox = await firstPageReponse.json();

    return (outbox.orderedItems || []).find((item) => item.id === activity.id);
}

async function waitForOutboxActivity(
    activity,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;
    const found = await findInOutbox(activity);

    if (found) {
        return;
    }

    if (options.retryCount >= MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting on an activity in the outbox`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    await waitForOutboxActivity(activity, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

Then('{string} is not in our Outbox', async function (activityName) {
    const activity = this.activities[activityName];
    const found = await findInOutbox(activity);
    assert(
        !found,
        `Expected not to find activity "${activityName}" in outbox, but it was found`,
    );
});

Then('{string} is in our Outbox', async function (activityName) {
    const activity = this.activities[activityName];
    await waitForOutboxActivity(activity);
});

async function waitForOutboxActivityType(
    activityType,
    objectType,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const initialResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/outbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const initialResponseJson = await initialResponse.json();
    const firstPageReponse = await fetchActivityPub(initialResponseJson.first, {
        headers: {
            Accept: 'application/ld+json',
        },
    });
    const outbox = await firstPageReponse.json();

    const found = (outbox.orderedItems || []).find((item) => {
        return item.type === activityType && item.object?.type === objectType;
    });

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting for ${activityType}(${objectType}) in the outbox`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return waitForOutboxActivityType(activityType, objectType, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

Then(
    'Activity {string} is sent to {string}',
    async function (activityName, actorName) {
        const actor = this.actors[actorName];
        const inbox = new URL(actor.inbox);
        const activity = this.activities[activityName];

        const found = await waitForRequest('POST', inbox.pathname, (call) => {
            const json = JSON.parse(call.request.body);
            return (
                json.type === activity.type &&
                json.object.id === activity.object.id
            );
        });

        assert(found);
    },
);

Then(
    'Activity {string} is sent to all followers',
    async function (activityName) {
        const followersResponse = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/followers/index',
        );
        const followersResponseJson = await followersResponse.json();

        const followers = followersResponseJson.orderedItems;

        const activity = this.activities[activityName];

        for (const followerUrl of followers) {
            const follower = await (await fetchActivityPub(followerUrl)).json();
            const inbox = new URL(follower.inbox);

            const found = await waitForRequest(
                'POST',
                inbox.pathname,
                (call) => {
                    const json = JSON.parse(call.request.body);

                    return (
                        json.type === activity.type &&
                        json.object.id === activity.object.id
                    );
                },
            );

            assert(
                found,
                `Activity "${activityName}" was not sent to "${follower.name}"`,
            );
        }
    },
);

const endpoints = {
    'post.published':
        'http://fake-ghost-activitypub/.ghost/activitypub/webhooks/post/published',
};

Given('a {string} webhook', function (string) {
    this.payloadType = string;
});

Given('a {string} webhook:', function (string, properties) {
    this.payloadType = string;
    this.payloadData = {};

    for (const { property, value } of properties.hashes()) {
        property.split('.').reduce((acc, key, idx, arr) => {
            if (idx === arr.length - 1) {
                acc[key] = value;
            } else {
                acc[key] = acc[key] || {};
            }

            return acc[key];
        }, this.payloadData);
    }
});

When('it is sent to the webhook endpoint', async function () {
    const endpoint = endpoints[this.payloadType];
    let payload = createWebhookPost();
    if (this.payloadData) {
        payload = merge(payload, this.payloadData);
    }
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const hmac = createHmac('sha256', webhookSecret)
        .update(body + timestamp)
        .digest('hex');

    this.response = await fetchActivityPub(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
        },
        body: body,
    });
});

When(
    'it is sent to the webhook endpoint with an old signature',
    async function () {
        const endpoint = endpoints[this.payloadType];
        const payload = createWebhookPost();
        const body = JSON.stringify(payload);
        const timestamp = Date.now() - 60 * 60 * 1000; // An hour old
        const hmac = createHmac('sha256', webhookSecret)
            .update(body + timestamp)
            .digest('hex');

        this.response = await fetchActivityPub(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
            },
            body: body,
        });
    },
);

When(
    'it is sent to the webhook endpoint without a signature',
    async function () {
        const endpoint = endpoints[this.payloadType];
        const payload = createWebhookPost();
        this.response = await fetchActivityPub(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ld+json',
            },
            body: JSON.stringify(payload),
        });
    },
);

Then('the request is rejected', function () {
    assert(!this.response.ok);
});

Then('the request is rejected with a {int}', function (statusCode) {
    assert(!this.response.ok);
    assert.equal(this.response.status, statusCode);
});

Then('the request is accepted', async function () {
    assert(
        this.response.ok,
        `Expected OK response - got ${this.response.status} ${await this.response.clone().text()}`,
    );
});

Then('the request is accepted with a {int}', function (statusCode) {
    assert(this.response.ok);
    assert.equal(
        this.response.status,
        statusCode,
        `Expected status code ${statusCode} - got ${this.response.status}`,
    );
});

Then('a {string} activity is in the Outbox', async function (string) {
    const [match, activity, object] = string.match(/(\w+)\((\w+)\)/) || [null];
    if (!match) {
        throw new Error(`Could not match ${string} to an activity`);
    }

    const found = await waitForOutboxActivityType(activity, object);

    if (!this.found) {
        this.found = {};
    }
    this.found[string] = found;
    assert.ok(found);
});

Then('the found {string} as {string}', function (foundName, name) {
    const found = this.found[foundName];

    const { activity, object } = parseActivityString(name);

    this.activities[activity] = found;
    this.objects[object] = found.object;
});

Then('the found {string} has property {string}', function (name, prop) {
    const found = this.found[name];

    const property = prop
        .split('.')
        .reduce((thing, key) => thing?.[key], found);

    assert.ok(property);
});

Then(
    'the found {string} has property {string} of type {string}',
    function (name, prop, type) {
        const found = this.found[name];

        const property = prop
            .split('.')
            .reduce((thing, key) => thing?.[key], found);

        assert.equal(typeof property, type);
    },
);

Then('{string} is in our Inbox', async function (activityName) {
    const activity = this.activities[activityName];

    await waitForInboxActivity(activity);
});

Then(
    '{string} is in our Inbox with Object {string}',
    async function (activityName, objectName) {
        const activity = this.activities[activityName];
        const object = this.objects[objectName];

        await waitForInboxActivity(activity, object);
    },
);

Then('{string} is not in our Inbox', async function (activityName) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const activity = this.activities[activityName];

    const found = inbox.items.find((item) => item.id === activity.id);

    assert(!found);
});

Then('{string} is in our Followers', async function (actorName) {
    const initialResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/followers/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const followers = await initialResponse.json();

    const actor = this.actors[actorName];

    const found = (followers.orderedItems || []).find(
        (item) => item === actor.id,
    );

    assert(found);
});

Then('{string} is in our Followers once only', async function (actorName) {
    const initialResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/followers/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const followers = await initialResponse.json();
    const actor = this.actors[actorName];
    const found = (followers.orderedItems || []).filter(
        (item) => item === actor.id,
    );

    assert.equal(found.length, 1);
});

Then(
    'a {string} activity is sent to {string}',
    async function (activityString, actorName) {
        const { activity: activityType, object: objectNameOrType } =
            parseActivityString(activityString);
        if (!activityType) {
            throw new Error(`could not match ${activityString} to an activity`);
        }
        if (!this.actors[actorName]) {
            throw new Error(`Could not find Actor ${actorName}`);
        }
        const actor = this.actors[actorName];

        const object = this.objects[objectNameOrType];

        const inboxUrl = new URL(actor.inbox);

        const found = await waitForRequest(
            'POST',
            inboxUrl.pathname,
            (call) => {
                const body = JSON.parse(call.request.body);
                if (body.type !== activityType) {
                    return false;
                }

                if (object) {
                    if (typeof body.object === 'string') {
                        return body.object === object.id;
                    }
                    return body.object.id === object.id;
                }

                return body.object.type === objectNameOrType;
            },
        );

        assert(found);
    },
);

When('we attempt to create a note with no content', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/actions/note',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        },
    );
});

When('we attempt to create a note with invalid content', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/actions/note',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: [],
            }),
        },
    );
});

When(
    'we create a note {string} with the content',
    async function (noteName, noteContent) {
        this.response = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/actions/note',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: noteContent,
                }),
            },
        );

        if (this.response.ok) {
            const activity = await this.response.clone().json();

            this.activities[noteName] = activity;
            this.objects[noteName] = activity.object;
        }
    },
);

When(
    'we attempt to reply to {string} with no content',
    async function (objectName) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub/.ghost/activitypub/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            },
        );
    },
);

When(
    'we attempt to reply to {string} with invalid content',
    async function (objectName) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub/.ghost/activitypub/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: [],
                }),
            },
        );
    },
);

When('we attempt to reply to an unknown object', async function () {
    const id = 'http://fake-external-activitypub/note/123';

    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/reply/${encodeURIComponent(id)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: 'Hello, world!',
            }),
        },
    );
});

When(
    'we reply {string} to {string} with the content',
    async function (replyName, objectName, replyContent) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub/.ghost/activitypub/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: replyContent,
                }),
            },
        );

        if (this.response.ok) {
            const activity = await this.response.clone().json();

            this.activities[replyName] = activity;
            this.objects[replyName] = activity.object;
        }
    },
);

Then('{string} has the content {string}', function (activityName, content) {
    const activity = this.activities[activityName];

    assert.equal(activity.object.content, content);
});

Given('{string} has Object {string}', function (activityName, objectName) {
    const activity = this.activities[activityName];
    const object = this.objects[objectName];

    this.activities[activityName] = { ...activity, object };
});

When('we request the feed with the next cursor', async function () {
    const responseJson = await this.response.clone().json();
    const nextCursor = responseJson.next;

    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/feed/index?next=${encodeURIComponent(nextCursor)}`,
        {
            headers: {
                Accept: 'application/json',
            },
        },
    );
});

Then(
    /"([^"]*)" is in the (posts|feed|liked posts)/,
    async function (activityOrObjectName, responseType) {
        const responseJson = await this.response.clone().json();
        const activity = this.activities[activityOrObjectName];
        const object = this.objects[activityOrObjectName];
        let found;

        if (activity) {
            found = responseJson.posts.find(
                (post) => post.url === activity.object.id,
            );
        } else if (object) {
            found = responseJson.posts.find((post) => post.url === object.id);
        }

        assert(
            found,
            `Expected to find ${activityOrObjectName} in ${responseType}`,
        );
    },
);

Then(
    'the {string} in the feed has content {string}',
    async function (activityOrObjectName, content) {
        const responseJson = await this.response.clone().json();
        const activity = this.activities[activityOrObjectName];
        const object = this.objects[activityOrObjectName];
        let found;

        if (activity) {
            found = responseJson.posts.find(
                (post) => post.url === activity.object.id,
            );
        } else if (object) {
            found = responseJson.posts.find((post) => post.url === object.id);
        }

        assert.equal(found.content, content);
    },
);

Then(
    /"([^"]*)" is not in the (posts|feed|liked posts)/,
    async function (activityOrObjectName, responseType) {
        const responseJson = await this.response.clone().json();
        const activity = this.activities[activityOrObjectName];
        const object = this.objects[activityOrObjectName];
        let found;

        if (activity) {
            found = responseJson.posts.find((post) => post.url === activity.id);
        } else if (object) {
            found = responseJson.posts.find((post) => post.url === object.id);
        }

        assert(
            !found,
            `Expected not to find ${activityOrObjectName} in ${responseType}`,
        );
    },
);

Then(
    /the (posts|feed|liked posts) response has a next cursor/,
    async function (type) {
        const responseJson = await this.response.clone().json();

        assert(
            responseJson.next,
            `Expected ${type} response to have a next cursor`,
        );
    },
);

Then(
    'post {string} in the {string} response is {string}',
    async function (postNumber, type, activityOrObjectName) {
        const responseJson = await this.response.clone().json();
        const activity = this.activities[activityOrObjectName];
        const object = this.objects[activityOrObjectName];
        const post = responseJson.posts[Number(postNumber) - 1];

        if (activity) {
            assert(post.url === activity.object.id);
        } else if (object) {
            assert(post.url === object.id);
        }
    },
);

Then(
    'post {string} in the thread is {string}',
    async function (postNumber, objectName) {
        const responseJson = await this.response.clone().json();

        const object = this.objects[objectName];
        const post = responseJson.posts[Number(postNumber) - 1];

        assert(post, `Expected to find ${objectName} in thread`);

        assert(
            post.url === object.id,
            `Expected ${objectName} to be at position ${postNumber} in thread`,
        );
    },
);

Then('the thread contains {string} posts', async function (string) {
    const responseJson = await this.response.clone().json();

    assert.equal(
        responseJson.posts.length,
        Number(string),
        `Expected thread to contain ${string} posts, but got ${responseJson.posts.length}`,
    );
});

Then(
    'post {string} has {string} set to {string}',
    async function (postNumber, key, value) {
        const responseJson = await this.response.clone().json();
        const post = responseJson.posts[Number(postNumber) - 1];

        assert(post, `Expected to find post ${postNumber} in thread`);

        assert(
            String(post[key]) === String(value),
            `Expected post ${postNumber} to have ${key} ${value}`,
        );
    },
);

Then('the response contains our account details', async function () {
    const responseJson = await this.response.clone().json();
    const ourActor = this.actors.Us;

    assert.equal(responseJson.name, ourActor.name);
    assert.equal(responseJson.handle, ourActor.handle);
    assert.equal(responseJson.bio, ourActor.summary);
    assert.equal(responseJson.url, ourActor.url);
    assert.equal(responseJson.avatarUrl, ourActor.icon?.url || '');
    assert.equal(responseJson.bannerImageUrl, ourActor.image?.url || '');
    assert.equal(typeof responseJson.postCount, 'number');
    assert.equal(typeof responseJson.likedCount, 'number');
    assert.equal(typeof responseJson.followingCount, 'number');
    assert.equal(typeof responseJson.followerCount, 'number');
    assert.equal(typeof responseJson.followedByMe, 'boolean');
    assert.equal(typeof responseJson.followsMe, 'boolean');
});

Then("the response contains John's account details", async function () {
    const responseJson = await this.response.clone().json();

    assert.equal(responseJson.name, "John O'Nolan");
    assert.equal(responseJson.handle, '@johnonolan@mastodon.xyz');
});
