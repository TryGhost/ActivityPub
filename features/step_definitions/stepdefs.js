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

function generateObject(type) {
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
            content: '<p>This is a test article</p>',
            published: '2020-04-20T04:20:00Z',
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
            content: '<p>This is a test note</p>',
            published: '2020-04-20T04:20:00Z',
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

async function createObject(type, actor) {
    const object = generateObject(type);

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
        },
    });

    await client('key_value').truncate();

    await client('sites').truncate();

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

Before(async () => {
    await externalActivityPub.clearAllRequests();
    await client('key_value').truncate();
    await client('sites').truncate();

    await client('sites').insert({
        host: 'fake-ghost-activitypub',
        webhook_secret: webhookSecret,
    });
});

Before(async function () {
    if (!this.activities) {
        this.activities = {};
    }
    if (!this.objects) {
        this.objects = {};
    }
    if (!this.actors) {
        this.actors = {
            Us: await createActor('Test', { remote: false }),
        };
    }
});

async function fetchActivityPub(url, options = {}) {
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

    options.headers.Authorization = `Bearer ${token}`;
    return fetch(url, options);
}

Given('there is no entry in the sites table', async () => {
    await client('sites').truncate();
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

Given('we follow {string}', async function (name) {
    const handle = this.actors[name].handle;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub/.ghost/activitypub/actions/follow/${handle}`,
        {
            method: 'POST',
        },
    );
    if (this.response.ok) {
        const follow = await this.response.clone().json();
        this.objects[`Follow(${name})`] = follow;
    }
});

Given('we are followed by:', async function (actors) {
    for (const { name, type } of actors.hashes()) {
        // Create the actor
        this.actors[name] = await createActor(name, { type });

        // Create the follow activity
        const actor = this.actors[name];
        const object = this.actors.Us;
        const activity = await createActivity('Follow', object, actor);

        const key = `Follow(Us)_${name}`;
        this.activities[key] = activity;
        this.objects[key] = object;

        // Send the follow activity to the inbox
        this.response = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
            {
                method: 'POST',
                body: JSON.stringify(activity),
            },
        );

        await waitForInboxActivity(activity);
    }
});

Given('the list of followers is paginated across multiple pages', async () => {
    const followersResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub/.ghost/activitypub/followers/index',
    );
    const followersResponseJson = await followersResponse.json();

    const followersFirstPageReponse = await fetchActivityPub(
        followersResponseJson.first,
    );
    const followersFirstPageReponseJson =
        await followersFirstPageReponse.json();

    assert(
        followersFirstPageReponseJson.next,
        'Expected multiple pages of pagination but only got 1',
    );
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

Then(
    'the object {string} should be in the liked collection',
    async function (name) {
        const initialResponse = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/liked/index',
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        const initialResponseJson = await initialResponse.json();
        const firstPageReponse = await fetchActivityPub(
            initialResponseJson.first,
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        const liked = await firstPageReponse.json();

        const object = this.objects[name];

        // TODO Change this when liked collection is fixed to contain objects not Likes
        const found = (liked.orderedItems || []).find(
            (item) => item.object.id === object.id,
        );

        assert(found);
    },
);

Then(
    'the object {string} should not be in the liked collection',
    async function (name) {
        const initialResponse = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/liked/index',
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        const initialResponseJson = await initialResponse.json();
        const firstPageReponse = await fetchActivityPub(
            initialResponseJson.first,
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        const liked = await firstPageReponse.json();
        const object = this.objects[name];

        // TODO Change this when liked collection is fixed to contain objects not Likes
        const found = (liked.orderedItems || []).find(
            (item) => item.object.id === object.id,
        );

        assert(!found);
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

Given(
    'a {string} Activity {string} by {string}',
    async function (activityDef, name, actorName) {
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

        this.activities[name] = activity;
        this.objects[name] = object;
    },
);

Then(
    'an {string} Activity {string} is created by {string}',
    async function (activityDef, name, actorName) {
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

        this.activities[name] = activity;
        this.objects[name] = object;
    },
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
    object,
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

async function waitForOutboxActivity(
    activity,
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

    if (outbox.orderedItems.find((item) => item.id === activity.id)) {
        return;
    }

    if (options.retryCount === MAX_RETRIES) {
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
        // Retrieve all followers
        const followers = [];

        const followersResponse = await fetchActivityPub(
            'http://fake-ghost-activitypub/.ghost/activitypub/followers/index',
        );
        const followersResponseJson = await followersResponse.json();

        const followersFirstPageResponse = await fetchActivityPub(
            followersResponseJson.first,
        );
        const followersFirstPageResponseJson =
            await followersFirstPageResponse.json();

        followers.push(...followersFirstPageResponseJson.orderedItems);

        let nextPage = followersFirstPageResponseJson.next;

        while (nextPage) {
            const nextPageResponse = await fetchActivityPub(nextPage);
            const nextPageResponseJson = await nextPageResponse.json();

            followers.push(...nextPageResponseJson.orderedItems);

            nextPage = nextPageResponseJson.next;
        }

        // Check that the activity was sent to all followers
        const activity = this.activities[activityName];

        for (const follower of followers) {
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

const webhooks = {
    'post.published': {
        post: {
            current: {
                uuid: '986108d9-3d50-4701-9808-eab62e0885cf',
                title: 'This is a title.',
                html: '<p> This is some content. </p>',
                feature_image: null,
                visibility: 'paid',
                published_at: '1970-01-01T00:00:00.000Z',
                url: 'http://fake-external-activitypub/post/',
                excerpt: 'This is some content.',
            },
        },
    },
};

const endpoints = {
    'post.published':
        'http://fake-ghost-activitypub/.ghost/activitypub/webhooks/post/published',
};

Given('a valid {string} webhook', function (string) {
    this.payloadType = string;
});

When('it is sent to the webhook endpoint', async function () {
    const endpoint = endpoints[this.payloadType];
    const payload = webhooks[this.payloadType];
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
        const payload = webhooks[this.payloadType];
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
        const payload = webhooks[this.payloadType];
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

Then('a {string} activity is in the Outbox', async function (string) {
    const [match, activity, object] = string.match(/(\w+)\((\w+)\)/) || [null];
    if (!match) {
        throw new Error(`Could not match ${string} to an activity`);
    }
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
        return item.type === activity && item.object?.type === object;
    });
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
    const initialResponseJson = await initialResponse.json();
    const firstPageResponse = await fetchActivityPub(
        initialResponseJson.first,
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const followers = await firstPageResponse.json();

    const actor = this.actors[actorName];

    const found = (followers.orderedItems || []).find(
        (item) => item.id === actor.id,
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
    const initialResponseJson = await initialResponse.json();
    const firstPageResponse = await fetchActivityPub(
        initialResponseJson.first,
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const followers = await firstPageResponse.json();
    const actor = this.actors[actorName];
    const found = (followers.orderedItems || []).filter(
        (item) => item.id === actor.id,
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
                return (
                    body.type === activityType &&
                    (object
                        ? body.object.id === object.id
                        : body.object.type === objectNameOrType)
                );
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
        }
    },
);

Then('{string} is in our Outbox', async function (activityName) {
    const activity = this.activities[activityName];

    await waitForOutboxActivity(activity);
});

Then('{string} has the content {string}', function (activityName, content) {
    const activity = this.activities[activityName];

    assert(activity.object.content === content);
});

Given('{string} has Object {string}', function (activityName, objectName) {
    const activity = this.activities[activityName];
    const object = this.objects[objectName];

    this.activities[activityName] = { ...activity, object };
});
