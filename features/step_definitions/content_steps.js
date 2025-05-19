import { createHmac } from 'node:crypto';
import { Given } from '@cucumber/cucumber';
import { createWebhookPost, getWebhookSecret } from '../support/fixtures.js';
import { fetchActivityPub } from '../support/request.js';

Given('we publish an article', async function () {
    if (this.articleId) {
        throw new Error('This step does not support multiple articles');
    }
    const endpoint =
        'http://fake-ghost-activitypub.test/.ghost/activitypub/webhooks/post/published';
    const payload = createWebhookPost();
    const body = JSON.stringify(payload);
    const timestamp = Date.now();
    const hmac = createHmac('sha256', getWebhookSecret())
        .update(body + timestamp)
        .digest('hex');

    const response = await fetchActivityPub(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
        },
        body: body,
    });

    const post = await response.json();

    this.articleId = post.id;
});
