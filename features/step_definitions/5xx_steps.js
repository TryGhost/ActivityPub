import { Given, Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';
import { createHmac } from 'node:crypto';

import {
    createActor,
    createWebhookPost,
    getWebhookSecret,
} from '../support/fixtures.js';

Given('we are sent invalid @context values to the inbox', async function () {
    const actor = await createActor('Alice');

    this.response = await fetch(
        'https://self.test/.ghost/activitypub/inbox/index',
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
            'https://self.test/.ghost/activitypub/inbox/index',
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

Given('we are sent invalid url to the inbox', async function () {
    this.response = await fetch(
        'https://self.test/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ld+json',
            },
            body: JSON.stringify({
                '@context': [
                    'https://www.w3.org/ns/activitystreams',
                    {
                        alsoKnownAs: {
                            '@id': 'as:alsoKnownAs',
                            '@type': '@id',
                        },
                    },
                ],
                type: 'Person',
                alsoKnownAs: 'invalid URL',
            }),
        },
    );
});

Given('we are sent invalid type to the inbox', async function () {
    this.response = await fetch(
        'https://self.test/.ghost/activitypub/inbox/index',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ld+json',
            },
            body: JSON.stringify({
                '@context': ['https://www.w3.org/ns/activitystreams', {}],
                type: 'https://www.w3.org/ns/activitystreams#Hashtag',
            }),
        },
    );
});

Given('we are sent a publish webhook', async function () {
    const endpoint =
        'https://self.test/.ghost/activitypub/v1/webhooks/post/published';
    const payload = createWebhookPost();
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const hmac = createHmac('sha256', getWebhookSecret())
        .update(body + timestamp)
        .digest('hex');

    this.firstPublishWebhook = payload;
    this.response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
        },
        body: body,
    });
});

When(
    'we are sent a second publish webhook for the same post',
    async function () {
        const endpoint =
            'https://self.test/.ghost/activitypub/v1/webhooks/post/published';
        const payload = this.firstPublishWebhook;
        const body = JSON.stringify(payload);
        const timestamp = Date.now();
        const hmac = createHmac('sha256', getWebhookSecret())
            .update(body + timestamp)
            .digest('hex');

        this.response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
            },
            body: body,
        });
    },
);

Then('we respond with a {int}', function (int) {
    assert.equal(this.response.status, int);
});
