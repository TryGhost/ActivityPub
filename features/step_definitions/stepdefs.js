import assert from 'assert';
import Knex from 'knex';
import { BeforeAll, AfterAll, Before, After, Given, When, Then } from '@cucumber/cucumber';
import { WireMock } from 'wiremock-captain';

async function createActivity(activityType, object, actor, remote = true) {
    if (activityType === 'Follow') {
        return {
            '@context': [
                'https://www.w3.org/ns/activitystreams',
                'https://w3id.org/security/data-integrity/v1',
            ],
            'type': 'Follow',
            'id': 'http://wiremock:8080/follow/1',
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
            'id': 'http://wiremock:8080/accept/1',
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
            'id': 'http://wiremock:8080/create/1',
            'to': 'as:Public',
            'object': object,
            actor: actor,
        };
    }
}

async function createActor(name = 'Test', remote = true) {
    if (remote === false) {
        return {
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

async function createObject(type) {
    if (type === 'Article') {
        return {
            'type': 'Article',
            'id': 'http://wiremock:8080/article/1',
            'to': 'as:Public',
            'cc': 'http://wiremock:8080/followers',
            'url': 'http://wiremock:8080/article/1',
            'content': '<p>This is a test article</p>',
            'published': '2020-04-20T04:20:00Z',
            'attributedTo': 'http://wiremock:8080/user'
        };
    }
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
    if (!this.actors) {
        this.actors = {
            Us: await createActor('Test', false)
        };
    }
})

Given('an Actor {string}', async function (name) {
    this.actors[name] = await createActor(name);
});

Given('a {string} Activity {string} by {string}', async function (activityDef, name, actorName) {
    const [match, activityType, objectName] = activityDef.match(/(\w+)\((\w+)\)/) || [null]
    if (!match) {
        throw new error(`could not match ${activityDef} to an activity`);
    }

    const object = this.actors[objectName] ?? this.activities[objectName] ?? await createObject(objectName);
    const actor  = this.actors[actorName];

    const activity = await createActivity(activityType, object, actor);

    this.activities[name] = activity;
});

Then('an {string} Activity {string} is created by {string}', async function (activityDef, name, actorName) {
    const [match, activityType, objectName] = activityDef.match(/(\w+)\((\w+)\)/) || [null]
    if (!match) {
        throw new error(`could not match ${activityDef} to an activity`);
    }

    const object = this.actors[objectName] ?? this.activities[objectName] ?? await createObject(objectName);
    const actor  = this.actors[actorName];

    const activity = await createActivity(activityType, object, actor);

    this.activities[name] = activity;
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
    console.log(JSON.stringify(outbox, null, 4));
    const found = outbox.orderedItems.find((item) => {
        return item.type === activity && item.object?.type === object
    });
    assert.ok(found);
});

Then('{string} is in our Inbox', async function (activityName) {
    const response = await fetch('http://activitypub-testing:8083/.ghost/activitypub/inbox/index', {
        headers: {
            Accept: 'application/ld+json'
        }
    });
    const inbox = await response.json();
    const activity = this.activities[activityName];

    console.log(JSON.stringify(inbox, null, 4));
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

    console.log(JSON.stringify(followers, null, 4));

    const found = followers.orderedItems.find(item => item.id === actor.id);

    assert(found);
});
