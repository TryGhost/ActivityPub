import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import { waitForOutboxNote } from '../support/activitypub.js';

import { fetchActivityPub, waitForRequest } from '../support/request.js';

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
            this.posts[noteName] = post;
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
            this.posts[noteName] = post;
        }
    },
);

Then('note {string} is in our Outbox', async function (noteName) {
    const note = this.posts[noteName];
    await waitForOutboxNote(note);
});

Then('note {string} is sent to all followers', async function (noteName) {
    const followersResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/followers/index',
    );
    const followersResponseJson = await followersResponse.json();

    const followers = followersResponseJson.orderedItems;

    const note = this.posts[noteName];

    for (const followerUrl of followers) {
        const follower = await (await fetchActivityPub(followerUrl)).json();
        const inbox = new URL(follower.inbox);

        const found = await waitForRequest('POST', inbox.pathname, (call) => {
            const json = JSON.parse(call.request.body);

            return json.object.type === 'Note' && json.object.id === note.id;
        });

        assert(found, `Note "${noteName}" was not sent to "${follower.name}"`);
    }
});

Then(
    'note {string} has the image URL {string}',
    function (noteName, expectedImageUrl) {
        const activity = this.activities[noteName];
        const note = this.posts[noteName];
        if (activity) {
            assert.equal(activity.object.attachment.url, expectedImageUrl);
            assert.equal(activity.object.attachment.type, 'Image');
        } else if (note) {
            assert.equal(note.attachments[0].type, 'Image');
            assert.equal(note.attachments[0].url, expectedImageUrl);
        }
    },
);
