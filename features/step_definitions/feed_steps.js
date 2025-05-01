import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

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
