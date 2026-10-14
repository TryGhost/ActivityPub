import { Given, Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';

import { createActivity, createActor } from '../support/fixtures.js';
import { waitForFollowerToBeAdded } from '../support/followers.js';
import { fetchActivityPub, waitForRequest } from '../support/request.js';
import { parseActivityString, parseActorString } from '../support/steps.js';
import { isInternalAccount } from '../support/utils.js';

async function ensureActor(world, input) {
    const parsed = parseActorString(input);
    const name = parsed.name ?? input;
    const type = parsed.type ?? 'Person';

    if (!world.actors[name]) {
        world.actors[name] = await createActor(name, { type });
    }

    return { name, actor: world.actors[name] };
}

function siteOriginForInternalActor(actor) {
    return new URL(actor.id).origin;
}

async function waitForActorFollowing(
    followerActor,
    followingId,
    { shouldFollow, label },
) {
    const MAX_RETRIES = 10;
    let delay = 0;

    for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const response = await fetchActivityPub(
            `${followerActor.following}?cursor=0`,
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        const following = await response.json();
        const found = (following.orderedItems || []).find(
            (item) => item === followingId,
        );

        if (Boolean(found) === shouldFollow) {
            return;
        }

        delay += 500;
    }

    throw new Error(
        `Timed out waiting for ${label} (following ${followingId})`,
    );
}

Given(
    'an Actor {string} with alias {string}',
    async function (actorInput, aliasInput) {
        const { actor: aliasActor } = await ensureActor(this, aliasInput);
        const parsed = parseActorString(actorInput);
        const name = parsed.name ?? actorInput;
        const type = parsed.type ?? 'Person';

        this.actors[name] = await createActor(name, {
            type,
            aliases: [aliasActor],
        });
    },
);

Given(
    'a Ghost-shaped remote Actor {string} with alias {string}',
    async function (actorInput, aliasInput) {
        const { actor: aliasActor } = await ensureActor(this, aliasInput);
        const parsed = parseActorString(actorInput);
        const name = parsed.name ?? actorInput;
        const type = parsed.type ?? 'Person';

        this.actors[name] = await createActor(name, {
            type,
            aliases: [aliasActor],
            ghostShaped: true,
        });
    },
);

Given(
    'a {string} Activity {string} by {string} with target {string}',
    async function (activityDef, name, actorName, targetName) {
        const { activity: activityType, object: objectName } =
            parseActivityString(activityDef);
        if (!activityType) {
            throw new Error(`could not match ${activityDef} to an activity`);
        }

        const actor = this.actors[actorName];
        if (!actor) {
            throw new Error(`Could not find Actor ${actorName}`);
        }

        const object =
            this.actors[objectName] ??
            this.activities[objectName] ??
            this.objects[objectName];
        if (!object) {
            throw new Error(`Could not find object ${objectName}`);
        }

        const target = this.actors[targetName];
        if (!target) {
            throw new Error(`Could not find target Actor ${targetName}`);
        }

        const activity = await createActivity(activityType, object, actor, {
            target,
        });

        const parsedName = parseActivityString(name);
        if (parsedName.activity === null || parsedName.object === null) {
            this.activities[name] = activity;
            this.objects[name] = object;
        } else {
            this.activities[parsedName.activity] = activity;
            this.objects[parsedName.object] = object;
        }
    },
);

Given('{string} is following Us', async function (actorName) {
    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(`Could not find Actor ${actorName}`);
    }

    if (isInternalAccount(actorName)) {
        const response = await fetchActivityPub(
            `${siteOriginForInternalActor(actor)}/.ghost/activitypub/v1/actions/follow/@index@self.test`,
            { method: 'POST' },
        );
        assert.ok(
            response.ok,
            `Expected ${actorName} to follow Us, got ${response.status}`,
        );
        await waitForFollowerToBeAdded(actor.id);
        return;
    }

    const object = this.actors.Us;
    const activity = await createActivity('Follow', object, actor);
    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            body: JSON.stringify(activity),
        },
    );
    assert.ok(
        response.ok,
        `Expected Follow to be accepted, got ${response.status}`,
    );
    await waitForFollowerToBeAdded(actor.id);
});

Given('{string} has aliased Us', async function (actorName) {
    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(`Could not find Actor ${actorName}`);
    }

    if (isInternalAccount(actorName)) {
        const response = await fetchActivityPub(
            `${siteOriginForInternalActor(actor)}/.ghost/activitypub/v1/aliases`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sourceHandle: '@index@self.test',
                }),
            },
        );
        assert.ok(
            response.ok,
            `Expected alias to be created, got ${response.status}`,
        );
        return;
    }

    throw new Error(
        `Aliasing Us from remote actor ${actorName} is not supported in this step; create the actor with an alias instead`,
    );
});

When('we migrate to {string}', async function (actorName) {
    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(`Could not find Actor ${actorName}`);
    }

    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/migration',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                targetHandle: actor.handle,
            }),
        },
    );
});

Then('the migration is accepted', async function () {
    assert.equal(
        this.response.status,
        200,
        `Expected migration to return 200, got ${this.response.status}`,
    );
    const body = await this.response.json();
    assert.equal(body.sent, true);
});

Then(
    '{string} is following {string}',
    async function (followerName, followingName) {
        const follower = this.actors[followerName];
        const following = this.actors[followingName];
        if (!follower || !following) {
            throw new Error(
                `Could not find actors ${followerName} / ${followingName}`,
            );
        }

        await waitForActorFollowing(follower, following.id, {
            shouldFollow: true,
            label: `${followerName} following ${followingName}`,
        });
    },
);

Then(
    '{string} is not following {string}',
    async function (followerName, followingName) {
        const follower = this.actors[followerName];
        const following =
            followingName === 'Us'
                ? this.actors.Us
                : this.actors[followingName];
        if (!follower || !following) {
            throw new Error(
                `Could not find actors ${followerName} / ${followingName}`,
            );
        }

        await waitForActorFollowing(follower, following.id, {
            shouldFollow: false,
            label: `${followerName} not following ${followingName}`,
        });
    },
);

Then('a Move activity is sent to {string}', async function (actorName) {
    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(`Could not find Actor ${actorName}`);
    }

    const inbox = new URL(actor.inbox);
    const found = await waitForRequest('POST', inbox.pathname, (call) => {
        const json = JSON.parse(call.request.body);
        return json.type === 'Move';
    });

    assert.ok(found, `Expected a Move activity to be sent to ${actorName}`);
});
