import assert from 'node:assert';

import { Given, Then } from '@cucumber/cucumber';

import { waitForInboxActivity } from '../support/activitypub.js';
import { createActivity, createActor } from '../support/fixtures.js';
import { fetchActivityPub } from '../support/request.js';
import { parseActorString } from '../support/steps.js';

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
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/follow/${actor.handle}`,
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
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
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
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/follow/${handle}`,
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
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/unfollow/${handle}`,
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
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
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

Then('{string} is in our Followers', async function (actorName) {
    const initialResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/followers/index',
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
        'http://fake-ghost-activitypub.test/.ghost/activitypub/followers/index',
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

Then('{string} is not in our Followers', async function (actorName) {
    const initialResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/followers/index',
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

    assert(!found);
});
