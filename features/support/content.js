import { createHmac } from 'node:crypto';
import { createWebhookPost, getWebhookSecret } from './fixtures.js';
import { fetchActivityPub } from './request.js';

export async function publishArticle() {
    const endpoint =
        'https://self.test/.ghost/activitypub/v1/webhooks/post/published';
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

    return post;
}

export async function publishNote(content = 'This is a note') {
    const endpoint = 'https://self.test/.ghost/activitypub/v1/actions/note';
    const payload = { content };
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

    const json = await response.json();
    const post = json.post;

    return post;
}
