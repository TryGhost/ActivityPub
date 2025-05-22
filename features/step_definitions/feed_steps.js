import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import { waitForAPObjectInFeed } from '../support/feed.js';
import { fetchActivityPub } from '../support/request.js';

When('we request the feed with the next cursor', async function () {
    const responseJson = await this.response.clone().json();
    const nextCursor = responseJson.next;

    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/feed/index?next=${encodeURIComponent(nextCursor)}`,
        {
            headers: {
                Accept: 'application/json',
            },
        },
    );
});

Then(
    'the {string} in the feed has content {string}',
    async function (activityOrObjectName, content) {
        const responseJson = await this.response.clone().json();
        const activity = this.activities[activityOrObjectName];
        const object = this.objects[activityOrObjectName];
        let found;

        if (activity) {
            found = responseJson.posts.find(
                (post) => post.url === activity.object.id,
            );
        } else if (object) {
            found = responseJson.posts.find((post) => post.url === object.id);
        }

        assert.equal(found.content, content);
    },
);

Then('the note {string} is in our feed', async function (noteName) {
    const note = this.objects[noteName];

    const found = await waitForAPObjectInFeed(note.id);
    assert(found);
});

Then('the note {string} is not in our feed', async function (noteName) {
    const note = this.objects[noteName];

    try {
        await waitForAPObjectInFeed(note.id);
        assert.fail('Expected note to be not be found in the feed');
    } catch (error) {
        assert.equal(
            error.message,
            `Max retries reached when waiting on item ${note.id} in the feed`,
        );
    }
});

Then('the article {string} is in our feed', async function (articleName) {
    const article = this.objects[articleName];

    const found = await waitForAPObjectInFeed(article.id);
    assert(found);
});

Then('the article {string} is not in our feed', async function (articleName) {
    const article = this.objects[articleName];

    try {
        await waitForAPObjectInFeed(article.id);
        assert.fail('Expected article to be not be found in the feed');
    } catch (error) {
        assert.equal(
            error.message,
            `Max retries reached when waiting on item ${article.id} in the feed`,
        );
    }
});
