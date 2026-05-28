import { Given } from '@cucumber/cucumber';

import { createActivity, createActor } from '../support/fixtures.js';
import { parseActivityString, parseActorString } from '../support/steps.js';

async function ensureActor(world, input) {
    const parsed = parseActorString(input);
    const name = parsed.name ?? input;
    const type = parsed.type ?? 'Person';

    if (!world.actors[name]) {
        world.actors[name] = await createActor(name, { type });
    }

    return { name, actor: world.actors[name] };
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
