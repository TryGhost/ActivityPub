import assert from 'node:assert';
import { Given, Then } from '@cucumber/cucumber';
import { createActor } from '../support/fixtures.js';

Given('we are sent invalid @context values to the inbox', async function () {
    const actor = await createActor('Alice');

    this.response = await fetch(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ld+json',
            },
            body: JSON.stringify({
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    true, // boolean is invalid
                    23, // number is invalid
                ],
                type: 'Create',
                object: {
                    type: 'Note',
                    content: 'Hello, world!',
                },
                actor: actor,
            }),
        },
    );
});

Given(
    'we are sent invalid nested @context values to the inbox',
    async function () {
        const actor = await createActor('Alice');

        this.response = await fetch(
            'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/ld+json',
                },
                body: JSON.stringify({
                    '@context': [
                        'https://www.w3.org/ns/activitystreams',
                        {
                            invalidContext: true,
                        },
                    ],
                    type: 'Create',
                    object: {
                        type: 'Note',
                        content: 'Hello, world!',
                    },
                    actor: actor,
                }),
            },
        );
    },
);

Then('we respond with a {int}', function (int) {
    assert.equal(this.response.status, int);
});
