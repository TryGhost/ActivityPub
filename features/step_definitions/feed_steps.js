import assert from 'node:assert';

import { Then } from '@cucumber/cucumber';

import { waitForAPObjectInFeed } from '../support/feed.js';

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

Then(
    'the note {string} is in our feed and has content {string}',
    async function (noteName, content) {
        const note = this.objects[noteName];

        const found = await waitForAPObjectInFeed(note.id);
        assert(found);
        assert.equal(found.content, content);
    },
);

Then('the {string} is in our feed and has an image', async function (noteName) {
    const note = this.objects[noteName];

    const found = await waitForAPObjectInFeed(note.id);
    assert(found);
    assert.equal(found.attachments[0].type, 'Image');
    assert(found.attachments[0].url);
    assert(!found.attachments[0].name);
});

Then(
    'the {string} is in our feed and has an image and alt text',
    async function (noteName) {
        const note = this.objects[noteName];

        const found = await waitForAPObjectInFeed(note.id);
        assert(found);
        assert.equal(found.attachments[0].type, 'Image');
        assert(found.attachments[0].url);
        assert(found.attachments[0].name);
    },
);

Then('the note {string} is not in our feed', async function (noteName) {
    const note = this.objects[noteName];

    try {
        await waitForAPObjectInFeed(note.id);
        assert.fail(`Expected note ${note.id} to be not be found in the feed`);
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
        assert.fail(
            `Expected article ${article.id} to be not be found in the feed`,
        );
    } catch (error) {
        assert.equal(
            error.message,
            `Max retries reached when waiting on item ${article.id} in the feed`,
        );
    }
});
