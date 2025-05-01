import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

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
            const activity = await this.response.clone().json();

            this.activities[noteName] = activity;
            this.objects[noteName] = activity.object;
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
            const activity = await this.response.clone().json();

            this.activities[noteName] = activity;
            this.objects[noteName] = activity.object;
        }
    },
);

Then(
    'note {string} has the image URL {string}',
    function (activityName, expectedImageUrl) {
        const activity = this.activities[activityName];
        assert.equal(activity.object.attachment.url, expectedImageUrl);
        assert.equal(activity.object.attachment.type, 'Image');
    },
);
