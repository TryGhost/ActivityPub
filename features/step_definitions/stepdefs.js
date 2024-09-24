import assert from 'assert';
import Knex from 'knex';
import { BeforeAll, AfterAll, Before, After, Given, When, Then } from '@cucumber/cucumber';
import { v4 as uuidv4 } from 'uuid';
import { WireMock } from 'wiremock-captain';

async function createActivity(activityType, object, actor, remote = true) {
    if (activityType === 'Follow') {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Follow',
            'id': `http://wiremock:8080/follow/${uuidv4()}`,
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
            'id': `http://wiremock:8080/accept/${uuidv4()}`,
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
            'id': `http://wiremock:8080/create/${uuidv4()}`,
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
            'id': `http://wiremock:8080/announce/${uuidv4()}`,
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
            'id': `http://wiremock:8080/like/${uuidv4()}`,
            'to': 'as:Public',
            'object': object,
            actor: actor,
        };
    }
}

async function createActor(name = 'Test', remote = true) {
    if (remote === false) {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'id': 'http://activitypub-testing:8083/.ghost/activitypub/users/index',
            'url': 'http://activitypub-testing:8083/.ghost/activitypub/users/index',
            'type': 'Person',

            'preferredUsername': 'index',
            'name': 'Test Actor',
            'summary': 'A test actor for testing',

            'inbox': 'http://activitypub-testing:8083/.ghost/activitypub/inbox/index',
            'outbox': 'http://activitypub-testing:8083/.ghost/activitypub/outbox/index',
            'followers': 'http://activitypub-testing:8083/.ghost/activitypub/followers/index',
            'following': 'http://activitypub-testing:8083/.ghost/activitypub/following/index',

            'https://w3id.org/security#publicKey': {
                'id':  'http://activitypub-testing:8083/.ghost/activitypub/users/index#main-key',
                'type': 'https://w3id.org/security#Key',
                'https://w3id.org/security#owner': {
                    'id': 'http://activitypub-testing:8083/.ghost/activitypub/users/index'
                },
                'https://w3id.org/security#publicKeyPem': '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n'
            }
        }
    }

    // Register endpoints with wiremock - for now just inbox

    captain.register({
        method: 'POST',
        endpoint: `/inbox/${name}`
    }, {
        status: 202
    });

    return {
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/data-integrity/v1',
        ],
        'id': `http://wiremock:8080/user/${name}`,
        'url': `http://wiremock:8080/user/${name}`,
        'type': 'Person',

        'preferredUsername': name,
        'name': name,
        'summary': 'A test actor for testing',

        'inbox': `http://wiremock:8080/inbox/${name}`,
        'outbox': `http://wiremock:8080/inbox/${name}`,
        'followers': `http://wiremock:8080/followers/${name}`,
        'following': `http://wiremock:8080/following/${name}`,

        'https://w3id.org/security#publicKey': {
            'id': 'http://wiremock:8080/user#main-key',
            'type': 'https://w3id.org/security#Key',
            'https://w3id.org/security#owner': {
                'id': 'http://wiremock:8080/user'
            },
            'https://w3id.org/security#publicKeyPem': '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSc3IqGjRaO3vcFdQ15D\nF90WVJC6tb2QwYBh9kQYVlQ1VhBiF6E4GK2okvyvukIL5PHLCgfQrfJmSiopk9Xo\n46Qri6rJbcPoWoZz/jWN0pfmU20hNuTQx6ebSoSkg6rHv1MKuy5LmDGLFC2ze3kU\nsY8u7X6TOBrifs/N+goLaH3+SkT2hZDKWJrmDyHzj043KLvXs/eiyu50M+ERoSlg\n70uO7QAXQFuLMILdy0UNJFM4xjlK6q4Jfbm4MC8QRG+i31AkmNvpY9JqCLqu0mGD\nBrdfJeN8PN+7DHW/Pzspf5RlJtlvBx1dS8Bxo2xteUyLGIaTZ9HZFhHc3IrmmKeW\naQIDAQAB\n-----END PUBLIC KEY-----\n'
        }
    };
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
            'id': `http://wiremock:8080/article/${uuid}`,
            'url': `http://wiremock:8080/article/${uuid}`,
            'to': 'as:Public',
            'cc': 'http://wiremock:8080/followers',
            'content': '<p>This is a test article</p>',
            'published': '2020-04-20T04:20:00Z',
            'attributedTo': 'http://wiremock:8080/user'
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
            'id': `http://wiremock:8080/note/${uuid}`,
            'url': `http://wiremock:8080/note/${uuid}`,
            'to': 'as:Public',
            'cc': 'http://wiremock:8080/followers',
            'content': '<p>This is a test note</p>',
            'published': '2020-04-20T04:20:00Z',
            'attributedTo': 'http://wiremock:8080/user'
        };
    }
}

async function createObject(type) {
    const object = generateObject(type);

    const url = new URL(object.id);

    captain.register({
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
let /* @type WireMock */ captain;

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
});

BeforeAll(async function () {
    captain = new WireMock('http://wiremock:8080');
});

AfterAll(async function () {
    await client.destroy();
});

Before(async function () {
    await captain.clearAllRequests();
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
})

Given('an Actor {string}', async function (name) {
    this.actors[name] = await createActor(name);
});

When('we like the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetch(`http://activitypub-testing:8083/.ghost/activitypub/actions/like/${encodeURIComponent(id)}`, {
        method: 'POST'
    });
});

When('we unlike the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetch(`http://activitypub-testing:8083/.ghost/activitypub/actions/unlike/${encodeURIComponent(id)}`, {
        method: 'POST'
    });
});

Then('the object {string} should be liked', async function (name) {
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/inbox/index', {
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
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/inbox/index', {
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
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/liked/index', {
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
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/liked/index', {
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

    this.response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json'
        },
        body: JSON.stringify(activity)
    });
});

Then('Activity {string} is sent to {string}', async function (activityName, actorName) {
    const actor = this.actors[actorName];
    const inbox = new URL(actor.inbox);
    const calls = await captain.getRequestsForAPI('POST', inbox.pathname);
    const activity = this.activities[activityName];

    const found = calls.find((call) => {
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
                "url": "http://wiremock:8080/post/",
                "excerpt": "This is some content.",
            }
        }
    }
};

const endpoints = {
    'post.published': 'http://activitypub-testing:8083/.ghost/activitypub/webhooks/post/published'
};

Given('a valid {string} webhook', function (string) {
    this.payloadType = string;
});

When('it is sent to the webhook endpoint', async function () {
    const endpoint = endpoints[this.payloadType];
    const payload = webhooks[this.payloadType];
    this.response = await fetch(endpoint, {
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
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/outbox/index', {
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
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/inbox/index', {
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
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/followers/index', {
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
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/followers/index', {
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

    const requests = await captain.getRequestsForAPI('POST', inboxUrl.pathname);

    const found = requests.find(request => {
        const body = JSON.parse(request.request.body);
        return body.type === activityType && (object ? body.object.id === object.id : body.object.type === objectNameOrType);
    });

    assert(found);
});
