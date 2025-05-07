import assert from 'node:assert';

import { Then } from '@cucumber/cucumber';

Then(
    'post {string} in the thread is {string}',
    async function (postNumber, objectName) {
        const responseJson = await this.response.clone().json();

        const object = this.objects[objectName] || this.posts[objectName];
        const post = responseJson.posts[Number(postNumber) - 1];

        assert(post, `Expected to find ${objectName} in thread`);

        assert(
            post.url === object.id,
            `Expected ${objectName} to be at position ${postNumber} in thread`,
        );
    },
);

Then('the thread contains {string} posts', async function (string) {
    const responseJson = await this.response.clone().json();

    assert.equal(
        responseJson.posts.length,
        Number(string),
        `Expected thread to contain ${string} posts, but got ${responseJson.posts.length}`,
    );
});
