import assert from 'node:assert';

import { Then } from '@cucumber/cucumber';

import { waitForAPObjectInInbox } from '../support/inbox.js';

Then('the article {string} is in our Inbox feed', async function (articleName) {
    const article = this.objects[articleName];

    const found = await waitForAPObjectInInbox(article.id);
    assert(found);
});

Then(
    'the article {string} is not in our Inbox feed',
    async function (articleName) {
        const article = this.objects[articleName];

        try {
            await waitForAPObjectInInbox(article.id);
            assert.fail(
                `Expected article ${article.id} to be not be found in the inbox`,
            );
        } catch (error) {
            assert.equal(
                error.message,
                `Max retries reached when waiting on item ${article.id} in the inbox`,
            );
        }
    },
);

Then('the note {string} is not in our Inbox feed', async function (noteName) {
    const note = this.objects[noteName];

    try {
        await waitForAPObjectInInbox(note.id);
        assert.fail(`Expected note ${note.id} to be not be found in the inbox`);
    } catch (error) {
        assert.equal(
            error.message,
            `Max retries reached when waiting on item ${note.id} in the inbox`,
        );
    }
});
