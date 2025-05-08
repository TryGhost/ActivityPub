import assert from 'node:assert';

import { Then } from '@cucumber/cucumber';

Then(
    /"([^"]*)" is in the (posts|feed|liked posts)/,
    async function (activityOrObjectName, responseType) {
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

        assert(
            found,
            `Expected to find ${activityOrObjectName} in ${responseType}`,
        );
    },
);

Then(
    /"([^"]*)" is not in the (posts|feed|liked posts)/,
    async function (activityOrObjectName, responseType) {
        const responseJson = await this.response.clone().json();
        const activity = this.activities[activityOrObjectName];
        const object = this.objects[activityOrObjectName];
        let found;

        if (activity) {
            found = responseJson.posts.find((post) => post.url === activity.id);
        } else if (object) {
            found = responseJson.posts.find((post) => post.url === object.id);
        }

        assert(
            !found,
            `Expected not to find ${activityOrObjectName} in ${responseType}`,
        );
    },
);

Then(
    /the (posts|feed|liked posts) response has a next cursor/,
    async function (type) {
        const responseJson = await this.response.clone().json();

        assert(
            responseJson.next,
            `Expected ${type} response to have a next cursor`,
        );
    },
);

Then(
    'post {string} in the {string} response is {string}',
    async function (postNumber, type, activityOrObjectName) {
        const responseJson = await this.response.clone().json();
        const activity = this.activities[activityOrObjectName];
        const object = this.objects[activityOrObjectName];
        const post = responseJson.posts[Number(postNumber) - 1];

        if (activity) {
            assert(post.url === activity.object.id);
        } else if (object) {
            assert(post.url === object.id);
        }
    },
);

Then(
    'post {string} has {string} set to {string}',
    async function (postNumber, key, value) {
        const responseJson = await this.response.clone().json();
        const post = responseJson.posts[Number(postNumber) - 1];

        assert(post, `Expected to find post ${postNumber} in thread`);

        assert(
            String(post[key]) === String(value),
            `Expected post ${postNumber} to have ${key} ${value}`,
        );
    },
);
