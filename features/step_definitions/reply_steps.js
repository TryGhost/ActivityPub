import { Given, Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';

import { waitForItemInFeed } from '../support/feed.js';
import { createActivity, createObject } from '../support/fixtures.js';
import { waitForItemInNotifications } from '../support/notifications.js';
import { fetchActivityPub } from '../support/request.js';

Given('{string} is a reply to {string}', async function (objectA, objectB) {
    this.objects[objectA].inReplyTo = this.objects[objectB].id;
});

When('{string} sends us a reply to our article', async function (actorName) {
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

    this.replyId = object.id;
});

When('{string} sends us a reply to our note', async function (actorName) {
    if (!this.noteId) {
        throw new Error(
            'You need to call a step which creates a note before this.',
        );
    }

    const actor = this.actors[actorName];
    if (!actor) {
        throw new Error(
            `Actor ${actorName} not found - did you forget a step?`,
        );
    }

    const object = await createObject('Note', actor, {
        content: 'This is a reply',
        inReplyTo: this.noteId,
    });
    const activity = await createActivity('Create', object, actor);

    await fetchActivityPub('https://self.test/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json',
        },
        body: JSON.stringify(activity),
    });

    this.replyId = object.id;
});

Then('the reply is in our notifications', async function () {
    if (!this.replyId) {
        throw new Error(
            'You need to call a step which creates a reply before this',
        );
    }
    const found = await waitForItemInNotifications(this.replyId);
    assert(found);
});

Then('the reply is in our feed', async function () {
    if (!this.replyId) {
        throw new Error(
            'You need to call a step which creates a reply before this',
        );
    }
    const found = await waitForItemInFeed(this.replyId);
    assert(found);
});

Then('the reply is not in our feed', async function () {
    if (!this.replyId) {
        throw new Error(
            'You need to call a step which creates a reply before this',
        );
    }

    try {
        await waitForItemInFeed(this.replyId);
        assert.fail(
            `Expected reply ${this.replyId} to be not be found in the feed`,
        );
    } catch (error) {
        assert.equal(
            error.message,
            `Max retries reached when waiting on item ${this.replyId} in the feed`,
        );
    }
});

When(
    'we attempt to reply to {string} with no content',
    async function (objectName) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `https://self.test/.ghost/activitypub/v1/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            },
        );
    },
);

When(
    'we attempt to reply to {string} with invalid content',
    async function (objectName) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `https://self.test/.ghost/activitypub/v1/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: [],
                }),
            },
        );
    },
);

When('we attempt to reply to an unknown object', async function () {
    const id = 'http://fake-external-activitypub.test/note/123';

    this.response = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/reply/${encodeURIComponent(id)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: 'Hello, world!',
            }),
        },
    );
});

When(
    'we reply {string} to {string} with the content',
    async function (replyName, objectName, replyContent) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `https://self.test/.ghost/activitypub/v1/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: replyContent,
                }),
            },
        );

        if (this.response.ok) {
            const activity = await this.response.clone().json();

            this.activities[replyName] = activity;
            this.objects[replyName] = activity.object;
        }
    },
);

When(
    'we reply {string} to {string} with imageUrl {string} and content',
    async function (replyName, objectName, imageUrl, replyContent) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `https://self.test/.ghost/activitypub/v1/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: replyContent,
                    imageUrl: imageUrl,
                }),
            },
        );

        if (this.response.ok) {
            const activity = await this.response.clone().json();

            this.activities[replyName] = activity;
            this.objects[replyName] = activity.object;
        }
    },
);
