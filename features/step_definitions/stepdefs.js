import assert from 'assert';
import Knex from 'knex';
import { BeforeAll, AfterAll, Before, After, Given, When, Then } from '@cucumber/cucumber';
import { v4 as uuidv4 } from 'uuid';
import { WireMock } from 'wiremock-captain';
import jose from 'node-jose';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import http from 'http';
import { createHmac } from 'crypto';

// Get the current file's URL and convert it to a path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function createActivity(activityType, object, actor, remote = true) {
    if (activityType === 'Follow') {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Follow',
            'id': `http://fake-external-activitypub/follow/${uuidv4()}`,
            'to': 'as:Public',
            'object': object,
            actor: actor,
        };
    }

    if (activityType === 'Accept') {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Accept',
            'id': `http://fake-external-activitypub/accept/${uuidv4()}`,
            'to': 'as:Public',
            'object': object,
            actor: actor,
        };
    }

    if (activityType === 'Create') {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Create',
            'id': `http://fake-external-activitypub/create/${uuidv4()}`,
            'to': 'as:Public',
            'object': object,
            actor: actor,
        };
    }

    if (activityType === 'Announce') {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Announce',
            'id': `http://fake-external-activitypub/announce/${uuidv4()}`,
            'to': 'as:Public',
            'object': object,
            actor: actor,
        };
    }

    if (activityType === 'Like') {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Like',
            'id': `http://fake-external-activitypub/like/${uuidv4()}`,
            'to': 'as:Public',
            'object': object,
            actor: actor,
        };
    }
}

function getActorHandle(actor, remote = true) {
    return `@${actor.preferredUsername}@${remote ? 'fake-external-activitypub' : 'fake-ghost-activitypub'}`;
}

async function createActor(name = 'Test', remote = true) {
    if (remote === false) {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'id': 'http://fake-ghost-activitypub/.ghost/activitypub/users/index',
            'url': 'http://fake-ghost-activitypub/.ghost/activitypub/users/index',
            'type': 'Person',

            'preferredUsername': 'index',
            'name': 'Test Actor',
            'summary': 'A test actor for testing',

            'inbox': 'http://fake-ghost-activitypub/.ghost/activitypub/inbox/index',
            'outbox': 'http://fake-ghost-activitypub/.ghost/activitypub/outbox/index',
            'followers': 'http://fake-ghost-activitypub/.ghost/activitypub/followers/index',
            'following': 'http://fake-ghost-activitypub/.ghost/activitypub/following/index',

            'https://w3id.org/security#publicKey': {
                'id':  'http://fake-ghost-activitypub/.ghost/activitypub/users/index#main-key',
                'type': 'https://w3id.org/security#Key',
                'https://w3id.org/security#owner': {
                    'id': 'http://fake-ghost-activitypub/.ghost/activitypub/users/index'
                },
                'https://w3id.org/security#publicKeyPem': '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n'
            }
        }
    }

    const actor = {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/data-integrity/v1',
        ],
        id: `http://fake-external-activitypub/user/${name}`,
        url: `http://fake-external-activitypub/user/${name}`,
        type: 'Person',

        preferredUsername: name,
        name: name,
        summary: 'A test actor for testing',

        inbox: `http://fake-external-activitypub/inbox/${name}`,
        outbox: `http://fake-external-activitypub/outbox/${name}`,
        followers: `http://fake-external-activitypub/followers/${name}`,
        following: `http://fake-external-activitypub/following/${name}`,

        'https://w3id.org/security#publicKey': {
            id: 'http://fake-external-activitypub/user#main-key',
            type: 'https://w3id.org/security#Key',
            'https://w3id.org/security#owner': {
                id: 'http://fake-external-activitypub/user'
            },
            'https://w3id.org/security#publicKeyPem': '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n'
        }
    };

    // Mock webfinger
    externalActivityPub.register({
        method: 'GET',
        endpoint: `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${getActorHandle(actor).substring(1)}`)}`
    }, {
        status: 200,
        body: {
            links: [
                {
                    rel: "self",
                    type: "application/activity+json",
                    href: actor.id
                },
            ]
        }
    });

    // Mock user
    externalActivityPub.register({
        method: 'GET',
        endpoint: `/user/${name}`
    }, {
        status: 200,
        body: actor
    });

    // Mock followers collection
    externalActivityPub.register({
        method: 'GET',
        endpoint: `/followers/${name}`
    }, {
        status: 200,
        body: {
            "@context": [
                "https://www.w3.org/ns/activitystreams",
                "https://w3id.org/security/data-integrity/v1",
            ],
            id: actor.followers,
            type: "OrderedCollection",
            orderedItems: []
        }
    });

    // Mock following collection
    externalActivityPub.register({
        method: 'GET',
        endpoint: `/following/${name}`
    }, {
        status: 200,
        body: {
            "@context": [
                "https://www.w3.org/ns/activitystreams",
                "https://w3id.org/security/data-integrity/v1",
            ],
            id: actor.following,
            type: "OrderedCollection",
            orderedItems: []
        }
    });

    // Mock outbox collection
    externalActivityPub.register({
        method: 'GET',
        endpoint: `/outbox/${name}`
    }, {
        status: 200,
        body: {
            "@context": [
                "https://www.w3.org/ns/activitystreams",
                "https://w3id.org/security/data-integrity/v1",
            ],
            id: actor.outbox,
            type: "OrderedCollection",
            orderedItems: []
        }
    });

    // Mock inbox
    externalActivityPub.register({
        method: 'POST',
        endpoint: `/inbox/${name}`
    }, {
        status: 202
    });

    return actor;
}

function generateObject(type) {
    if (type === 'Article') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Article',
            'id': `http://fake-external-activitypub/article/${uuid}`,
            'url': `http://fake-external-activitypub/article/${uuid}`,
            'to': 'as:Public',
            'cc': 'http://fake-external-activitypub/followers',
            'content': '<p>This is a test article</p>',
            'published': '2020-04-20T04:20:00Z',
            'attributedTo': 'http://fake-external-activitypub/user'
        };
    }

    if (type === 'Note') {
        const uuid = uuidv4();
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Note',
            'id': `http://fake-external-activitypub/note/${uuid}`,
            'url': `http://fake-external-activitypub/note/${uuid}`,
            'to': 'as:Public',
            'cc': 'http://fake-external-activitypub/followers',
            'content': '<p>This is a test note</p>',
            'published': '2020-04-20T04:20:00Z',
            'attributedTo': 'http://fake-external-activitypub/user'
        };
    }
}

async function createObject(type) {
    const object = generateObject(type);

    const url = new URL(object.id);

    externalActivityPub.register({
        method: 'GET',
        endpoint: url.pathname
    }, {
        status: 200,
        body: object,
        headers: {
            'Content-Type': 'application/activity+json'
        }
    });

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
    const [match, activity, object] = string.match(/(\w+)\((\w+)\)/) || [null]
    if (!match) {
        return {
            activity: null,
            object: null
        };
    }
    return {
        activity,
        object
    };
}

let /* @type Knex */ client;
let /* @type WireMock */ externalActivityPub;
let /* @type WireMock */ ghostActivityPub;
let webhookSecret;

BeforeAll(async function () {
    client = Knex({
        client: 'mysql2',
        connection: {
            host: process.env.MYSQL_HOST,
            port: parseInt(process.env.MYSQL_PORT),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        }
    });

    await client('key_value').truncate();

    await client('sites').truncate();

    webhookSecret = fs.readFileSync(resolve(__dirname, '../fixtures/webhook_secret.txt'), 'utf8')
    await client('sites').insert({
        host: 'fake-ghost-activitypub',
        webhook_secret: webhookSecret
    });
});

BeforeAll(async function () {
    externalActivityPub = new WireMock('http://fake-external-activitypub');
    ghostActivityPub = new WireMock('http://fake-ghost-activitypub');

    const publicKey = fs.readFileSync(resolve(__dirname, '../fixtures/private.key'), 'utf8');

    const key = await jose.JWK.asKey(publicKey, 'pem', {
        kid: 'test-key-id'
    })
    const jwk = key.toJSON();

    ghostActivityPub.register({
        method: 'GET',
        endpoint: '/ghost/.well-known/jwks.json'
    }, {
        status: 200,
        body: {
            keys: [jwk]
        },
        headers: {
            'Content-Type': 'application/activity+json'
        }
    });
});

AfterAll(async function () {
    await client.destroy();
});

Before(async function () {
    await externalActivityPub.clearAllRequests();
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
            Us: await createActor('Test', false)
        };
    }
});

async function fetchActivityPub(url, options = { method: 'GET' }) {
    if (!options.headers) {
        options.headers = {};
    }

    const privateKey = fs.readFileSync(resolve(__dirname, '../fixtures/private.key'));
    const token = jwt.sign({
        sub: 'test@user.com',
        role: 'Owner'
    }, privateKey, {
        algorithm: 'RS256',
        keyid: 'test-key-id',
        expiresIn: '5m'
    });

    options.headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, options);
}

Given('an Actor {string}', async function (name) {
    this.actors[name] = await createActor(name);
});

When('we like the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(`http://fake-ghost-activitypub/.ghost/activitypub/actions/like/${encodeURIComponent(id)}`, {
        method: 'POST'
    });
});

When('we unlike the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(`http://fake-ghost-activitypub/.ghost/activitypub/actions/unlike/${encodeURIComponent(id)}`, {
        method: 'POST'
    });
});

Then('the object {string} should be liked', async function (name) {
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/inbox/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const inbox = await response.json();
    const object = this.objects[name];

    const found = inbox.items.find(item => item.object.id === object.id);

    assert(found.object.liked === true);
});

Then('the object {string} should not be liked', async function (name) {
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/inbox/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const inbox = await response.json();
    const object = this.objects[name];

    const found = inbox.items.find(item => item.object.id === object.id);

    assert(found.object.liked !== true);
});

Then('the object {string} should be in the liked collection', async function (name) {
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/liked/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const inbox = await response.json();
    const object = this.objects[name];

    // TODO Change this when liked collection is fixed to contain objects not Likes
    const found = inbox.orderedItems.find(item => item.object.id === object.id);

    assert(found);
});

Then('the object {string} should not be in the liked collection', async function (name) {
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/liked/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const inbox = await response.json();
    const object = this.objects[name];

    // TODO Change this when liked collection is fixed to contain objects not Likes
    const found = inbox.orderedItems.find(item => item.object.id === object.id);

    assert(!found);
});

Given('a {string} Activity {string} by {string}', async function (activityDef, name, actorName) {
    const {activity: activityType, object: objectName} = parseActivityString(activityDef);
    if (!activityType) {
        throw new error(`could not match ${activityDef} to an activity`);
    }

    const object = this.actors[objectName] ?? this.activities[objectName] ?? await createObject(objectName);
    const actor  = this.actors[actorName];

    const activity = await createActivity(activityType, object, actor);

    this.activities[name] = activity;
    this.objects[name] = object;
});

Then('an {string} Activity {string} is created by {string}', async function (activityDef, name, actorName) {
    const {activity: activityType, object: objectName} = parseActivityString(activityDef);
    if (!activityType) {
        throw new error(`could not match ${activityDef} to an activity`);
    }

    const object = this.actors[objectName] ?? this.activities[objectName] ?? await createObject(objectName);
    const actor  = this.actors[actorName];

    const activity = await createActivity(activityType, object, actor);

    this.activities[name] = activity;
    this.objects[name] = object;
});

When('{string} sends {string} to the Inbox', async function (actorName, activityName) {
    if (!this.actors[actorName]) {
        throw new Error(`Could not find Actor ${actorName}`);
    }
    if (!this.activities[activityName]) {
        throw new Error(`Could not find Activity ${activityName}`);
    }

    const activity = this.activities[activityName];

    this.response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json'
        },
        body: JSON.stringify(activity)
    });
});

async function wait(n) {
    return new Promise(resolve => setTimeout(resolve, n));
}

async function waitForRequest(method, path, matcher, step = 100, milliseconds = 1000) {
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

Then('Activity {string} is sent to {string}', async function (activityName, actorName) {
    const actor = this.actors[actorName];
    const inbox = new URL(actor.inbox);
    const activity = this.activities[activityName];

    const found = await waitForRequest('POST', inbox.pathname, (call) => {
        const json = JSON.parse(call.request.body);
        return json.type === activity.type && json.object.id === activity.object.id;
    });

    assert(found);
});

const webhooks = {
    'post.published': {
        "post": {
            "current": {
                "uuid": "986108d9-3d50-4701-9808-eab62e0885cf",
                "title": "This is a title.",
                "html": "<p> This is some content. </p>",
                "feature_image": null,
                "visibility": "paid",
                "published_at": "1970-01-01T00:00:00.000Z",
                "url": "http://fake-external-activitypub/post/",
                "excerpt": "This is some content.",
            }
        }
    }
};

const endpoints = {
    'post.published': 'http://fake-ghost-activitypub/.ghost/activitypub/webhooks/post/published'
};

Given('a valid {string} webhook', function (string) {
    this.payloadType = string;
});

When('it is sent to the webhook endpoint', async function () {
    const endpoint = endpoints[this.payloadType];
    const payload = webhooks[this.payloadType];
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const hmac = createHmac('sha256', webhookSecret).update(body + timestamp).digest('hex');

    this.response = await fetchActivityPub(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`
        },
        body: body
    });
});

When('it is sent to the webhook endpoint with an old signature', async function () {
    const endpoint = endpoints[this.payloadType];
    const payload = webhooks[this.payloadType];
    const body = JSON.stringify(payload);
    const timestamp = Date.now() - (60 * 60 * 1000); // An hour old
    const hmac = createHmac('sha256', webhookSecret).update(body + timestamp).digest('hex');

    this.response = await fetchActivityPub(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`
        },
        body: body
    });
});

When('it is sent to the webhook endpoint without a signature', async function () {
    const endpoint = endpoints[this.payloadType];
    const payload = webhooks[this.payloadType];
    this.response = await fetchActivityPub(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json'
        },
        body: JSON.stringify(payload)
    });
});

Then('the request is rejected', function () {
    assert(!this.response.ok);
});

Then('the request is rejected with a {int}', function (statusCode) {
    assert(!this.response.ok);
    assert.equal(this.response.status, statusCode);
});

Then('the request is accepted', async function () {
    assert(this.response.ok, `Expected OK response - got ${this.response.status} ${await this.response.clone().text()}`);
});

Then('a {string} activity is in the Outbox', async function (string) {
    const [match, activity, object] = string.match(/(\w+)\((\w+)\)/) || [null]
    if (!match) {
        throw new Error(`Could not match ${string} to an activity`);
    }
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/outbox/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const outbox = await response.json();
    const found = outbox.orderedItems.find((item) => {
        return item.type === activity && item.object?.type === object
    });
    if (!this.found) {
        this.found = {};
    }
    this.found[string] = found;
    assert.ok(found);
});

Then('the found {string} has property {string}', function (name, prop) {
    const found = this.found[name];

    const property = prop.split('.').reduce(function (thing, key) {
        return thing?.[key];
    }, found);

    assert.ok(property);
});

Then('{string} is in our Inbox', async function (activityName) {
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/inbox/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const inbox = await response.json();
    const activity = this.activities[activityName];

    const found = inbox.items.find(item => item.id === activity.id);

    assert(found);
});

Then('{string} is in our Followers', async function (actorName) {
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/followers/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const followers = await response.json();
    const actor = this.actors[actorName];

    const found = followers.orderedItems.find(item => item === actor.id);

    assert(found);
});

Then('{string} is in our Followers once only', async function (actorName) {
    const response = await fetchActivityPub('http://fake-ghost-activitypub/.ghost/activitypub/followers/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const followers = await response.json();
    const actor = this.actors[actorName];
    const found = followers.orderedItems.filter(item => item === actor.id);

    assert.equal(found.length, 1);
});

Then('a {string} activity is sent to {string}', async function (activityString, actorName) {
    const {activity: activityType, object: objectNameOrType} = parseActivityString(activityString);
    if (!activityType) {
        throw new error(`could not match ${activityDef} to an activity`);
    }
    if (!this.actors[actorName]) {
        throw new Error(`Could not find Actor ${actorName}`);
    }
    const actor = this.actors[actorName];

    const object = this.objects[objectNameOrType];

    const inboxUrl = new URL(actor.inbox);

    const found = await waitForRequest('POST', inboxUrl.pathname, (call) => {
        const body = JSON.parse(call.request.body);
        return body.type === activityType && (object ? body.object.id === object.id : body.object.type === objectNameOrType);
    });

    assert(found);
});

When('I request the profile for {string}', async function (name) {
    const actor = this.actors[name];

    this.response = await fetchActivityPub(`http://fake-ghost-activitypub/.ghost/activitypub/profile/${getActorHandle(actor)}`);
});

Then('the response has status code {int}', function (statusCode) {
    assert.strictEqual(this.response.status, statusCode);
});

Then('the response body is a valid profile', async function () {
    const profile = await this.response.json();

    assert.ok(profile.actor);

    const actor = this.actors[profile.actor.name];

    assert.equal(profile.actor.id, actor.id);
    assert.equal(profile.handle, getActorHandle(actor));
    assert.equal(profile.followerCount, 0);
    assert.equal(profile.followingCount, 0);
    assert.equal(profile.isFollowing, false);
    assert.deepEqual(profile.posts, []);
});
