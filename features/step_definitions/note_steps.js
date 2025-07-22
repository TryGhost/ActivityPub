import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import { fetchActivityPub } from '../support/request.js';
import { mapPostToActivityPubObject } from '../support/utils.js';

async function createNote(noteName, content, imageUrl, imageAltText) {
    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/actions/note',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: content,
                image: {
                    url: imageUrl ? imageUrl : undefined,
                    altText: imageAltText ? imageAltText : undefined,
                },
            }),
        },
    );

    if (this.response.ok) {
        const responseJson = await this.response.clone().json();
        const post = responseJson.post;
        const object = await mapPostToActivityPubObject(post);
        this.objects[noteName] = object;
    }
}

When('we attempt to create a note with no content', async function () {
    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/actions/note',
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
        'https://self.test/.ghost/activitypub/v1/actions/note',
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
            'https://self.test/.ghost/activitypub/v1/actions/note',
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
            'https://self.test/.ghost/activitypub/v1/actions/note',
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
        assert.ok(object.attachment, 'Note does not have attachments');

        assert.equal(object.attachment.url, expectedImageUrl);
        assert.equal(object.attachment.type, 'Image');
    },
);

When('we create a note {string} with an image', async function (noteName) {
    const content = 'Hello World';
    const imageUrl = 'https://self.test/.ghost/activitypub/gcs/image.jpg';
    await createNote.call(this, noteName, content, imageUrl);
});

When(
    'we create a note {string} with an image and alt text',
    async function (noteName) {
        const content = 'Hello World';
        const imageUrl = 'https://self.test/.ghost/activitypub/gcs/image.jpg';
        const imageAltText = 'Alt Text';
        await createNote.call(this, noteName, content, imageUrl, imageAltText);
    },
);

When(
    'we create a note {string} with an invalid image url',
    async function (noteName) {
        const content = 'Hello World';
        const imageUrl = 'not-a-url';
        await createNote.call(this, noteName, content, imageUrl);
    },
);

Then('the note is not created', function () {
    assert(!this.response.ok);
    assert.equal(this.response.status, 400);
});
