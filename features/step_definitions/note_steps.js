import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import { mapPostToActivityPubObject } from '../support/utils.js';

import { fetchActivityPub } from '../support/request.js';

When('we attempt to create a note with no content', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/actions/note',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        },
    );
});

When('we attempt to create a note with invalid content', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/actions/note',
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
});

When(
    'we create a note {string} with the content',
    async function (noteName, noteContent) {
        this.response = await fetchActivityPub(
            'http://fake-ghost-activitypub.test/.ghost/activitypub/actions/note',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: noteContent,
                }),
            },
        );

        if (this.response.ok) {
            const responseJson = await this.response.clone().json();
            const post = responseJson.post;
            const object = await mapPostToActivityPubObject(post);
            this.objects[noteName] = object;
        }
    },
);

When(
    'we create a note {string} with imageUrl {string} and content',
    async function (noteName, imageUrl, noteContent) {
        this.response = await fetchActivityPub(
            'http://fake-ghost-activitypub.test/.ghost/activitypub/actions/note',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: noteContent,
                    imageUrl: imageUrl,
                }),
            },
        );

        if (this.response.ok) {
            const responseJson = await this.response.clone().json();
            const post = responseJson.post;
            const object = await mapPostToActivityPubObject(post);
            this.objects[noteName] = object;
        }
    },
);

Then(
    'note {string} has the image URL {string}',
    function (noteName, expectedImageUrl) {
        const object = this.objects[noteName];
        assert.equal(object.attachment.url, expectedImageUrl);
        assert.equal(object.attachment.type, 'Image');
    },
);
