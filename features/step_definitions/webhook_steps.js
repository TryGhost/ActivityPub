import { createHmac } from 'node:crypto';

import { Given, When } from '@cucumber/cucumber';
import { merge } from 'es-toolkit';

import { createWebhookPost, getWebhookSecret } from '../support/fixtures.js';
import { fetchActivityPub } from '../support/request.js';

const endpoints = {
    'post.published':
        'https://self.test/.ghost/activitypub/v1/webhooks/post/published',
};

Given('a {string} webhook', function (string) {
    this.payloadType = string;
});

Given('a {string} webhook:', function (string, properties) {
    this.payloadType = string;
    this.payloadData = {};

    for (const { property, value } of properties.hashes()) {
        property.split('.').reduce((acc, key, idx, arr) => {
            if (idx === arr.length - 1) {
                acc[key] = value;
            } else {
                acc[key] = acc[key] || {};
            }

            return acc[key];
        }, this.payloadData);
    }
});

When('it is sent to the webhook endpoint', async function () {
    const endpoint = endpoints[this.payloadType];
    let payload = createWebhookPost();
    if (this.payloadData) {
        payload = merge(payload, this.payloadData);
    }
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const hmac = createHmac('sha256', getWebhookSecret())
        .update(body + timestamp)
        .digest('hex');

    this.response = await fetchActivityPub(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
        },
        body: body,
    });
});

When(
    'it is sent to the webhook endpoint with an old signature',
    async function () {
        const endpoint = endpoints[this.payloadType];
        const payload = createWebhookPost();
        const body = JSON.stringify(payload);
        const timestamp = Date.now() - 60 * 60 * 1000; // An hour old
        const hmac = createHmac('sha256', getWebhookSecret())
            .update(body + timestamp)
            .digest('hex');

        this.response = await fetchActivityPub(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
            },
            body: body,
        });
    },
);

When(
    'it is sent to the webhook endpoint without a signature',
    async function () {
        const endpoint = endpoints[this.payloadType];
        const payload = createWebhookPost();
        this.response = await fetchActivityPub(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ld+json',
            },
            body: JSON.stringify(payload),
        });
    },
);

When(
    'it is sent to the webhook endpoint with private visibility',
    async function () {
        const endpoint = endpoints[this.payloadType];
        let payload = createWebhookPost();
        if (this.payloadData) {
            payload = merge(payload, this.payloadData);
        }
        const body = JSON.stringify(payload);
        const timestamp = Date.now();
        const hmac = createHmac('sha256', getWebhookSecret())
            .update(body + timestamp)
            .digest('hex');

        this.response = await fetchActivityPub(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
            },
            body: body,
        });
    },
);
