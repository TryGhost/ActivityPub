import { Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';

import { v4 as uuidv4 } from 'uuid';

import { fetchActivityPub } from '../support/request.js';

When(
    'the ActivityPub object for the Ghost post is requested',
    async function () {
        const uuid = this.webhookPayload.post.current.uuid;

        this.response = await fetchActivityPub(
            `https://self.test/.ghost/activitypub/ghost-post/${uuid}`,
            { redirect: 'manual' },
            false,
        );
    },
);

When(
    'the ActivityPub object for an unknown Ghost post is requested',
    async function () {
        this.response = await fetchActivityPub(
            `https://self.test/.ghost/activitypub/ghost-post/${uuidv4()}`,
            { redirect: 'manual' },
            false,
        );
    },
);

Then('we are redirected to an ActivityPub article', async function () {
    assert.equal(this.response.status, 302);

    const location = this.response.headers.get('Location');

    const response = await fetchActivityPub(location, {
        headers: {
            Accept: 'application/activity+json',
        },
    });

    assert.equal(response.status, 200);

    const article = await response.json();

    assert.equal(article.type, 'Article');
    assert.equal(article.name, this.webhookPayload.post.current.title);
});
