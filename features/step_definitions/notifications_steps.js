import assert from 'node:assert';
import { Then, When } from '@cucumber/cucumber';
import { publishArticle } from '../support/content.js';
import { createActivity, createObject } from '../support/fixtures.js';
import {
    waitForItemInNotifications,
    waitForUnreadNotifications,
} from '../support/notifications.js';
import { fetchActivityPub } from '../support/request.js';

Then('the unread notifications count is {int}', async (count) => {
    const found = await waitForUnreadNotifications(count);
    assert(found);
});

When('we get a like notification from {string}', async function (actorName) {
    if (!this.articleId) {
        const article = await publishArticle();
        this.articleId = article.id;
    }

    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(
            `Actor ${actorName} not found - did you forget a step?`,
        );
    }

    const activity = await createActivity('Like', this.articleId, actor);
    await fetchActivityPub('https://self.test/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json',
        },
        body: JSON.stringify(activity),
    });

    await waitForItemInNotifications((notification) => {
        return (
            notification.type === 'like' &&
            notification.post?.id === this.articleId &&
            notification.actor?.url === actor.id
        );
    });
});

When('we get a reply notification from {string}', async function (actorName) {
    if (!this.articleId) {
        const article = await publishArticle();
        this.articleId = article.id;
    }

    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(
            `Actor ${actorName} not found - did you forget a step?`,
        );
    }

    const object = await createObject('Note', actor, {
        content: 'This is a reply',
        inReplyTo: this.articleId,
    });
    const activity = await createActivity('Create', object, actor);

    await fetchActivityPub('https://self.test/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json',
        },
        body: JSON.stringify(activity),
    });

    await waitForItemInNotifications(object.id);
});

When('we reset unread notifications count', async () => {
    await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/notifications/unread/reset',
        {
            method: 'PUT',
        },
    );
});
