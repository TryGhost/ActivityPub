import { Given, Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';

import {
    createActivity,
    createActor,
    createObject,
} from '../support/fixtures.js';
import { fetchActivityPub, waitForRequest } from '../support/request.js';
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

Given('a {string} Activity {string} by {string}', activityCreatedBy);

Given(
    'a {string} Activity {string} by {string} with content {string}',
    activityCreatedByWithContent,
);

Given(
    'an {string} Activity {string} is created by {string}',
    activityCreatedBy,
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
        'https://self.test/.ghost/activitypub/outbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

When('we request the followers collection', async function () {
    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/followers/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

When('we request the following collection', async function () {
    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/following/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

When('we request the liked collection', async function () {
    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/liked/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

When('we request the webfinger', async function () {
    this.response = await fetchActivityPub(
        'https://self.test/.well-known/webfinger?resource=acct:index@self.test',
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
            'https://self.test/.ghost/activitypub/inbox/index',
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
        `https://self.test/.ghost/activitypub/${collectionType}/index`,
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

Then(
    'Activity {string} is sent to {string}',
    async function (activityName, actorName) {
        const actor = this.actors[actorName];
        const inbox = new URL(actor.inbox);
        const activity = this.activities[activityName];

        const found = await waitForRequest('POST', inbox.pathname, (call) => {
            const json = JSON.parse(call.request.body);

            if (json.type !== activity.type) return false;

            const objectId =
                typeof json.object === 'string' ? json.object : json.object?.id;

            return objectId === activity.object.id;
        });

        assert(found);
    },
);

async function getFollowers() {
    const followersResponse = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/followers/index',
    );
    const followersResponseJson = await followersResponse.json();

    return Promise.all(
        followersResponseJson.orderedItems.map(async (item) => {
            const follower = await (await fetchActivityPub(item)).json();

            return {
                inbox: new URL(follower.inbox),
                name: follower.name,
            };
        }),
    );
}

Then(
    'A {string} Activity is sent to all followers',
    async function (activityString) {
        const [match, activity, object] = activityString.match(
            /(\w+)\((\w+)\)/,
        ) || [null];

        if (!match) {
            throw new Error(`Could not match ${activityString} to an activity`);
        }

        const followers = await getFollowers();

        const promises = followers.map((follower) =>
            waitForRequest('POST', follower.inbox.pathname, (call) => {
                const json = JSON.parse(call.request.body);

                return json.type === activity && json.object.type === object;
            }).then((activity) => ({ activity })),
        );

        const results = await Promise.allSettled(promises);

        if (!this.found) {
            this.found = {};
        }

        results.forEach((result, i) => {
            const followerName = followers[i].name;

            assert(
                result.status === 'fulfilled' && result.value.activity,
                `Activity "${activityString}" was not sent to "${followerName}"`,
            );

            this.found[activityString] = result.value.activity;
        });
    },
);

Then(
    'Activity with object {string} is sent to all followers',
    async function (objectName) {
        const object = this.objects[objectName];

        const followers = await getFollowers();

        const promises = followers.map((follower) =>
            waitForRequest('POST', follower.inbox.pathname, (call) => {
                const json = JSON.parse(call.request.body);

                return json.object.id === object.id;
            }).then((activity) => ({ activity })),
        );

        const results = await Promise.allSettled(promises);

        results.forEach((result, i) => {
            const followerName = followers[i].name;

            assert(
                result.status === 'fulfilled' && result.value.activity,
                `Activity with object "${objectName}" was not sent to "${followerName}"`,
            );
        });
    },
);

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

When('{string} announces {string}', async function (actorName, activityName) {
    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(`Could not find Actor ${actorName}`);
    }

    const targetActivity = this.activities[activityName];
    if (!targetActivity) {
        throw new Error(`Could not find Activity ${activityName}`);
    }

    const announceActivity = await createActivity(
        'Announce',
        targetActivity,
        actor,
    );

    await fetchActivityPub('https://self.test/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json',
        },
        body: JSON.stringify(announceActivity),
    });
});
