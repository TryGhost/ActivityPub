import assert from 'node:assert';
import { Then, When } from '@cucumber/cucumber';

import { createActivity } from '../support/fixtures.js';
import { waitForItemInInbox } from '../support/inbox.js';
import { waitForItemInNotifications } from '../support/notifications.js';
import { fetchActivityPub } from '../support/request.js';

When('we like the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/like/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

When('we unlike the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/unlike/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

When('{string} likes our article', async function (actorName) {
    if (!this.articleId) {
        throw new Error(
            'You need to call a step which creates an article before this.',
        );
    }

    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(
            `Actor ${actorName} not found - did you forget a step?`,
        );
    }

    const activity = await createActivity('Like', this.articleId, actor);
    await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ld+json',
            },
            body: JSON.stringify(activity),
        },
    );

    this.likeId = activity.id;
});

Then('the like is in our notifications', async function () {
    if (!this.articleId) {
        throw new Error(
            'You need to call a step which creates an article before this',
        );
    }

    if (!this.likeId) {
        throw new Error(
            'You need to call a step which likes an article before this',
        );
    }

    const found = await waitForItemInNotifications(this.articleId);
    assert(found);
});

Then('our article is liked', async function () {
    if (!this.articleId) {
        throw new Error(
            'You need to call a step which creates an article before this',
        );
    }

    const post = await waitForItemInInbox(this.articleId);

    assert(post.likeCount > 0);
});
