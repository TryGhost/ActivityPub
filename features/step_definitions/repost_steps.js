import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';
import { createActivity } from '../support/fixtures.js';
import { waitForItemInNotifications } from '../support/notifications.js';
import { fetchActivityPub } from '../support/request.js';
import { waitForRequest } from '../support/request.js';

When('we repost the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/repost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should be reposted', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/feed',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const feed = await response.json();
    const object = this.objects[name];

    const post = feed.posts.find((item) => item.id === object.id);

    assert.equal(post.repostedByMe, true);
});

Then(
    'the object {string} should have a repost count of {int}',
    async function (name, repostCount) {
        const response = await fetchActivityPub(
            'http://fake-ghost-activitypub.test/.ghost/activitypub/feed',
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );

        const feed = await response.json();
        const object = this.objects[name];

        const post = feed.posts.find((item) => item.id === object.id);

        assert.equal(post.repostCount, repostCount);
    },
);

When('we undo the repost of the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/derepost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should not be reposted', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const object = this.objects[name];
    const found = inbox.items.find((item) => item.object.id === object.id);

    assert(found.object.reposted !== true);
});

Then('an Undo\\(Announce) is sent to {string}', async function (actorName) {
    if (!this.actors[actorName]) {
        throw new Error(`Could not find Actor ${actorName}`);
    }
    const actor = this.actors[actorName];

    const inboxUrl = new URL(actor.inbox);

    const foundInInbox = await waitForRequest(
        'POST',
        inboxUrl.pathname,
        (call) => {
            const body = JSON.parse(call.request.body);
            return body.type === 'Undo' && body.object.type === 'Announce';
        },
    );

    const foundActivity = JSON.parse(foundInInbox.request.body);

    assert(foundActivity);
});

Then('an Announce\\(Note) is sent to {string}', async function (actorName) {
    if (!this.actors[actorName]) {
        throw new Error(`Could not find Actor ${actorName}`);
    }
    const actor = this.actors[actorName];

    const object = this.objects.Note;

    const inboxUrl = new URL(actor.inbox);

    const foundInInbox = await waitForRequest(
        'POST',
        inboxUrl.pathname,
        (call) => {
            const body = JSON.parse(call.request.body);
            if (body.type !== 'Announce') {
                return false;
            }

            if (object) {
                if (typeof body.object === 'string') {
                    return body.object === object.id;
                }
                return body.object.id === object.id;
            }

            return body.object.type === 'Note';
        },
    );

    const foundActivity = JSON.parse(foundInInbox.request.body);

    assert(foundActivity);
});

When('{string} reposts our note', async function (actorName) {
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

    const activity = await createActivity('Announce', this.noteId, actor);

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

    this.repostId = activity.id;
});

Then('the repost is in our notifications', async function () {
    if (!this.noteId) {
        throw new Error(
            'You need to call a step which creates a note before this',
        );
    }

    if (!this.repostId) {
        throw new Error(
            'You need to call a step which reposts a note before this',
        );
    }

    const found = await waitForItemInNotifications(this.noteId);
    assert(found);
});
