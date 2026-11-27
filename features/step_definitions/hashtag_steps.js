import { Given, Then } from '@cucumber/cucumber';

import assert from 'node:assert';

import { waitForAPObjectInFeed } from '../support/feed.js';
import { createActivity, createObject } from '../support/fixtures.js';
import { waitForRequest } from '../support/request.js';
import { parseActivityString } from '../support/steps.js';
import { getGhostWiremock } from '../support/wiremock.js';

Given('the site has a tag page for {string}', async (tag) => {
    await getGhostWiremock().register(
        { method: 'HEAD', endpoint: `/tag/${tag}/` },
        { status: 200 },
    );
});

Given(
    'a {string} Activity {string} by {string} with the hashtag {string}',
    async function (activityDef, name, actorName, hashtag) {
        const { activity: activityType, object: objectType } =
            parseActivityString(activityDef);
        const actor = this.actors[actorName];
        const href = `https://fake-external-activitypub.test/tags/${hashtag.slice(1)}`;

        const object = await createObject(
            objectType,
            actor,
            `<p>Hello <a href="${href}" class="mention hashtag" rel="tag">#<span>${hashtag.slice(1)}</span></a></p>`,
            [{ type: 'Hashtag', name: hashtag, href }],
            null,
            {
                // `Hashtag` is not part of the ActivityStreams context, so
                // servers like Mastodon define it themselves
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    'https://w3id.org/security/data-integrity/v1',
                    { Hashtag: 'as:Hashtag' },
                ],
            },
        );
        const activity = await createActivity(activityType, object, actor);

        this.activities[name] = activity;
        this.objects[name] = object;
    },
);

Then(
    '{string} is sent to {string} with the hashtags',
    async function (objectName, actorName, table) {
        const object = this.objects[objectName];
        const inbox = new URL(this.actors[actorName].inbox);

        const call = await waitForRequest(
            'POST',
            inbox.pathname,
            (call) => JSON.parse(call.request.body).object.id === object.id,
        );
        const sentObject = JSON.parse(call.request.body).object;
        const tags = Array.isArray(sentObject.tag)
            ? sentObject.tag
            : [sentObject.tag];

        assert.deepStrictEqual(
            tags
                .filter((tag) => tag?.type === 'Hashtag')
                .map((tag) => ({ name: tag.name, href: tag.href ?? '' })),
            table.hashes(),
        );
    },
);

Then(
    'the note {string} is in the hashtag feed for {string}',
    async function (noteName, hashtag) {
        const note = this.objects[noteName];

        const found = await waitForAPObjectInFeed(
            note.id,
            `https://self.test/.ghost/activitypub/v1/feed/hashtag/${encodeURIComponent(hashtag)}`,
        );
        assert(found);
    },
);

Then(
    'the search results contain the hashtag {string}',
    async function (hashtag) {
        const json = await this.response.clone().json();

        assert.deepEqual(json.hashtags, [{ name: hashtag }]);
    },
);
