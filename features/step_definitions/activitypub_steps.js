import assert from 'node:assert';

import { Given, Then, When } from '@cucumber/cucumber';

import {
    findInOutbox,
    waitForInboxActivity,
    waitForOutboxActivity,
    waitForOutboxObject,
} from '../support/activitypub.js';
import {
    createActivity,
    createActor,
    createObject,
} from '../support/fixtures.js';
import { fetchActivityPub } from '../support/request.js';
import { waitForRequest } from '../support/request.js';
import { parseActivityString, parseActorString } from '../support/steps.js';

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

async function activityCreatedByWithMention(
    activityDef,
    name,
    actorName,
    content,
    mentionedActorName,
) {
    const { activity: activityType, object: objectName } =
        parseActivityString(activityDef);
    if (!activityType) {
        throw new Error(`could not match ${activityDef} to an activity`);
    }

    const actor = this.actors[actorName];
    const mentionedActor = this.actors[mentionedActorName];
    const tags = [
        {
            type: 'Mention',
            name: `@${mentionedActor.username}@${mentionedActor.domain}`,
            href: mentionedActor.apId,
        },
    ];
    const object =
        this.actors[objectName] ??
        this.activities[objectName] ??
        this.objects[objectName] ??
        (await createObject(objectName, actor, content, tags));

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

Given(
    'a {string} Activity {string} by {string} with content {string} that mentions {string}',
    activityCreatedByWithMention,
);

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

Given(
    'a {string} Object {string} by {string}',
    async function (objectType, objectName, actorName) {
        const actor = this.actors[actorName];
        const object = await createObject(objectType, actor);

        this.objects[objectName] = object;
    },
);

Given('{string} has Object {string}', function (activityName, objectName) {
    const activity = this.activities[activityName];
    const object = this.objects[objectName];

    this.activities[activityName] = { ...activity, object };
});

When('we request the outbox', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/outbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

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
            'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
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

async function getObjectInCollection(objectName, collectionType) {
    const initialResponse = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/${collectionType}/index`,
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

Then('{string} is not in our Outbox', async function (activityName) {
    const activity = this.activities[activityName];
    const found = await findInOutbox(activity);
    assert(
        !found,
        `Expected not to find activity "${activityName}" in outbox, but it was found`,
    );
});

Then('{string} is in our Outbox', async function (name) {
    const activity = this.activities[name];
    if (activity) return waitForOutboxActivity(activity);
    const object = this.objects[name];
    if (object) return waitForOutboxObject(object);
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
        'http://fake-ghost-activitypub.test/.ghost/activitypub/outbox/index',
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
            'http://fake-ghost-activitypub.test/.ghost/activitypub/followers/index',
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

Then(
    'Activity with object {string} is sent to all followers',
    async function (objectName) {
        const followersResponse = await fetchActivityPub(
            'http://fake-ghost-activitypub.test/.ghost/activitypub/followers/index',
        );
        const followersResponseJson = await followersResponse.json();

        const followers = followersResponseJson.orderedItems;

        const object = this.objects[objectName];

        for (const followerUrl of followers) {
            const follower = await (await fetchActivityPub(followerUrl)).json();
            const inbox = new URL(follower.inbox);

            const found = await waitForRequest(
                'POST',
                inbox.pathname,
                (call) => {
                    const json = JSON.parse(call.request.body);

                    return json.object.id === object.id;
                },
            );

            assert(
                found,
                `Activity with object "${objectName}" was not sent to "${follower.name}"`,
            );
        }
    },
);

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
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
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

        const object =
            this.objects[objectNameOrType] || this.actors[objectNameOrType];

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

Then('{string} has the content {string}', function (postName, content) {
    const activity = this.activities[postName];
    if (activity) {
        assert.equal(activity.object.content, content);
    }
    const object = this.objects[postName];
    assert.equal(object.content, content);
});
