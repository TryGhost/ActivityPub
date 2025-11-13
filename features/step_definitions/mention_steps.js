import { Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';

import { createActivity, createObject } from '../support/fixtures.js';
import { waitForItemInNotifications } from '../support/notifications.js';
import { fetchActivityPub } from '../support/request.js';

When('{string} sends us a mention', async function (actorName) {
    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(
            `Actor ${actorName} not found - did you forget a step?`,
        );
    }

    const localActor = this.actors.Us;
    if (!localActor) {
        throw new Error('Local actor (Us) not found in test context');
    }

    const mention = `@${localActor.preferredUsername}@self.test`;
    const tags = [
        {
            type: 'Mention',
            name: mention,
            href: localActor.id,
        },
    ];

    const object = await createObject('Note', actor, `Hello ${mention}`, tags);
    const activity = await createActivity('Create', object, actor);

    await fetchActivityPub('https://self.test/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json',
        },
        body: JSON.stringify(activity),
    });

    this.mentionId = object.id;
    this.activities['Create(Note)'] = activity;
    this.objects.Note = object;
});

Then('the mention is in our notifications', async function () {
    if (!this.mentionId) {
        throw new Error(
            'You need to call a step which creates a mention before this',
        );
    }

    const found = await waitForItemInNotifications(this.mentionId);
    assert(found, `Expected mention ${this.mentionId} to be in notifications`);
});
