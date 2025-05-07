import { Given, When } from '@cucumber/cucumber';

import { fetchActivityPub } from '../support/request.js';

Given('{string} is a reply to {string}', async function (objectA, objectB) {
    this.objects[objectA].inReplyTo = this.objects[objectB].id;
});

When(
    'we attempt to reply to {string} with no content',
    async function (objectName) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            },
        );
    },
);

When(
    'we attempt to reply to {string} with invalid content',
    async function (objectName) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: [],
                }),
            },
        );
    },
);

When('we attempt to reply to an unknown object', async function () {
    const id = 'http://fake-external-activitypub.test/note/123';

    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/reply/${encodeURIComponent(id)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: 'Hello, world!',
            }),
        },
    );
});

When(
    'we reply {string} to {string} with the content',
    async function (replyName, objectName, replyContent) {
        const object = this.objects[objectName] || this.posts[objectName];

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: replyContent,
                }),
            },
        );

        if (this.response.ok) {
            const responseJson = await this.response.clone().json();
            const reply = responseJson.reply;
            this.posts[replyName] = reply;
        }
    },
);

When(
    'we reply {string} to {string} with imageUrl {string} and content',
    async function (replyName, objectName, imageUrl, replyContent) {
        const object = this.objects[objectName];

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/reply/${encodeURIComponent(object.id)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: replyContent,
                    imageUrl: imageUrl,
                }),
            },
        );

        if (this.response.ok) {
            const responseJson = await this.response.clone().json();
            const reply = responseJson.reply;
            this.posts[replyName] = reply;
        }
    },
);
