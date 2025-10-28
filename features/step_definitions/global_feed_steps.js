import { Then } from '@cucumber/cucumber';

import assert from 'node:assert';

import { waitForAPObjectInGlobalFeed } from '../support/global-feed.js';

Then(
    'the article {string} is not in our global feed',
    async function (articleName) {
        const article = this.objects[articleName];

        try {
            await waitForAPObjectInGlobalFeed(article.id);
            assert.fail(
                `Expected article ${article.id} to be not be found in the global feed`,
            );
        } catch (error) {
            assert.equal(
                error.message,
                `Max retries reached when waiting on item ${article.id} in the global feed`,
            );
        }
    },
);

Then('the note {string} is not in our global feed', async function (noteName) {
    const note = this.objects[noteName];

    try {
        await waitForAPObjectInGlobalFeed(note.id);
        assert.fail(
            `Expected note ${note.id} to be not be found in the global feed`,
        );
    } catch (error) {
        assert.equal(
            error.message,
            `Max retries reached when waiting on item ${note.id} in the global feed`,
        );
    }
});
