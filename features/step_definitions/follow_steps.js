import { Given, Then } from '@cucumber/cucumber';

import assert from 'node:assert';

import { createActivity, createActor } from '../support/fixtures.js';
import {
    waitForFollowerToBeAdded,
    waitForFollowerToBeRemoved,
} from '../support/followers.js';
import { waitForFollowingToBeAdded } from '../support/following.js';
import { fetchActivityPub } from '../support/request.js';
import { parseActorString } from '../support/steps.js';
import { isInternalAccount } from '../support/utils.js';

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

Given('we are not following {string}', async function (input) {
    const { actor } = await getActor.call(this, input);

    const unfollowResponse = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/unfollow/${actor.handle}`,
        {
            method: 'POST',
        },
    );

    if (!unfollowResponse.ok && unfollowResponse.status !== 409) {
        throw new Error('Something went wrong');
    }
});

Given('we are following {string}', async function (input) {
    const { actor } = await getActor.call(this, input);

    const followResponse = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/follow/${actor.handle}`,
        {
            method: 'POST',
        },
    );

    if (!followResponse.ok) {
        throw new Error('Something went wrong');
    }

    if (!isInternalAccount(input)) {
        const follow = await createActivity('Follow', actor, this.actors.Us);
        const accept = await createActivity('Accept', follow, actor);
        const acceptResponse = await fetchActivityPub(
            'https://self.test/.ghost/activitypub/inbox/index',
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
    }

    await waitForFollowingToBeAdded(actor.id);
});

Given('we follow {string}', async function (name) {
    const handle = this.actors[name].handle;
    this.response = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/follow/${handle}`,
        {
            method: 'POST',
        },
    );

    // If the account is internal, no federation happens so we don't need
    // to record the follow activity
    if (this.response.ok && !isInternalAccount(handle)) {
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
        `https://self.test/.ghost/activitypub/v1/actions/unfollow/${handle}`,
        {
            method: 'POST',
        },
    );

    if (!this.response.ok) {
        throw new Error('Something went wrong');
    }
});

async function weAreFollowedBy(actor) {
    const object = this.actors.Us;
    const activity = await createActivity('Follow', object, actor);

    // Send the follow activity to the inbox
    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            body: JSON.stringify(activity),
        },
    );

    if (!response.ok) {
        throw new Error('Something went wrong');
    }

    await waitForFollowerToBeAdded(actor.id);
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
        'https://self.test/.ghost/activitypub/followers/index',
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
        'https://self.test/.ghost/activitypub/followers/index',
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
    const actor = this.actors[actorName];

    const removed = await waitForFollowerToBeRemoved(actor.id);
    assert(removed);
});

Then('{string} is in our following', async function (actorName) {
    const initialResponse = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/following/index?cursor=0',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const following = await initialResponse.json();
    const actor = this.actors[actorName];
    const found = (following.orderedItems || []).find(
        (item) => item === actor.id,
    );

    assert(found);
});

Then('{string} is not in our following', async function (actorName) {
    const initialResponse = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/following/index?cursor=0',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const following = await initialResponse.json();
    const actor = this.actors[actorName];

    const found = (following.orderedItems || []).find(
        (item) => item === actor.id,
    );

    assert(!found);
});

Then("we are in {string}'s followers", async function (actorName) {
    const actor = this.actors[actorName];
    const initialResponse = await fetchActivityPub(
        `${actor.followers}?cursor=0`,
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const followers = await initialResponse.json();
    const found = (followers.orderedItems || []).find(
        (item) => item === this.actors.Us.id,
    );

    assert(found);
});

Then("we are not in {string}'s followers", async function (actorName) {
    const actor = this.actors[actorName];
    const initialResponse = await fetchActivityPub(
        `${actor.followers}?cursor=0`,
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const followers = await initialResponse.json();
    const found = (followers.orderedItems || []).find(
        (item) => item === this.actors.Us.id,
    );

    assert(!found);
});
