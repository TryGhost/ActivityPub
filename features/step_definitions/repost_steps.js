import { Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';

import { waitForAPObjectInFeed } from '../support/feed.js';
import { createActivity } from '../support/fixtures.js';
import { waitForAPObjectInInbox } from '../support/inbox.js';
import { waitForItemInNotifications } from '../support/notifications.js';
import { fetchActivityPub, waitForRequest } from '../support/request.js';

When('we repost the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/repost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should be reposted', async function (name) {
    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/feed/notes',
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
            'https://self.test/.ghost/activitypub/v1/feed/notes',
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
        `https://self.test/.ghost/activitypub/v1/actions/derepost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should not be reposted', async function (name) {
    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/feed/notes',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const feed = await response.json();
    const object = this.objects[name];

    const post = feed.posts.find((item) => item.id === object.id);

    assert.equal(post.repostedByMe, false);
});

Then('an Undo\\(Announce) is sent to {string}', async function (actorName) {
    if (!this.actors[actorName]) {
        throw new Error(`Could not find Actor ${actorName}`);
    }
    const actor = this.actors[actorName];

    const inboxUrl = new URL(actor.inbox);

    const found = await waitForRequest('POST', inboxUrl.pathname, (call) => {
        const body = JSON.parse(call.request.body);

        return body.type === 'Undo' && body.object.type === 'Announce';
    });

    assert(found);
});

Then('an Announce\\(Note) is sent to {string}', async function (actorName) {
    if (!this.actors[actorName]) {
        throw new Error(`Could not find Actor ${actorName}`);
    }
    const actor = this.actors[actorName];

    const object = this.objects.Note;

    const inboxUrl = new URL(actor.inbox);

    const found = await waitForRequest('POST', inboxUrl.pathname, (call) => {
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
    });

    assert(found);
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

    await fetchActivityPub('https://self.test/.ghost/activitypub/inbox/index', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/ld+json',
        },
        body: JSON.stringify(activity),
    });

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

async function checkPostRepostedBy(world, objectType, objectName, actorName) {
    const object = world.objects[objectName];
    if (!object) {
        throw new Error(`Object ${objectName} not found`);
    }

    const actor = world.actors[actorName];
    if (!actor) {
        throw new Error(`Actor ${actorName} not found`);
    }

    // Determine which feed to check based on object type
    let feedUrl;
    if (objectType.toLowerCase() === 'article') {
        feedUrl = 'https://self.test/.ghost/activitypub/v1/feed/reader';
        await waitForAPObjectInInbox(object.id);
    } else {
        feedUrl = 'https://self.test/.ghost/activitypub/v1/feed/notes';
        await waitForAPObjectInFeed(object.id);
    }

    // Check if the post appears as reposted in the feed
    const response = await fetchActivityPub(feedUrl, {
        headers: {
            Accept: 'application/ld+json',
        },
    });

    const feed = await response.json();
    const post = feed.posts.find((item) => item.id === object.id);

    assert(post, `Post ${object.id} not found in feed`);

    // Check if the post shows it was reposted
    assert(post.repostCount > 0, 'Post has not been reposted');
    assert(post.repostedBy, 'Post does not have repostedBy information');
    assert(
        post.repostedBy.id === actor.id ||
            post.repostedBy.handle === actor.handle ||
            post.repostedBy.name === actorName,
        `Post was not reposted by ${actorName}`,
    );
}

Then(
    'the {string} {string} is reposted by {string}',
    async function (objectType, objectName, actorName) {
        await checkPostRepostedBy(this, objectType, objectName, actorName);
    },
);

Then(
    'the note {string} is reposted by {string}',
    async function (noteName, actorName) {
        await checkPostRepostedBy(this, 'note', noteName, actorName);
    },
);

Then(
    'the article {string} is reposted by {string}',
    async function (articleName, actorName) {
        await checkPostRepostedBy(this, 'article', articleName, actorName);
    },
);
