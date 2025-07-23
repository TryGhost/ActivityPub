import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { Given, Then, When } from '@cucumber/cucumber';
import { createWebhookPost, getWebhookSecret } from '../support/fixtures.js';
import { fetchActivityPub } from '../support/request.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

Given('I have internal account followers', async () => {
    const followers = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/followers/index',
    );
    const json = await followers.json();
    const initialFollowersCount = json.totalItems;
    let followersCount = initialFollowersCount;

    await Promise.all([
        fetchActivityPub(
            'https://alice.test/.ghost/activitypub/v1/actions/follow/@index@self.test',
            { method: 'POST' },
        ),
        fetchActivityPub(
            'https://bob.test/.ghost/activitypub/v1/actions/follow/@index@self.test',
            { method: 'POST' },
        ),
        fetchActivityPub(
            'https://carol.test/.ghost/activitypub/v1/actions/follow/@index@self.test',
            { method: 'POST' },
        ),
    ]);

    let attempts = 0;
    while (followersCount < initialFollowersCount + 3 && attempts++ < 100) {
        const followers = await fetchActivityPub(
            'https://self.test/.ghost/activitypub/followers/index',
        );
        const json = await followers.json();
        followersCount = json.totalItems;
        await sleep(100);
    }
});

When('I create a post in ghost', async function () {
    const body = JSON.stringify(createWebhookPost());
    const timestamp = Date.now();
    const hmac = createHmac('sha256', getWebhookSecret())
        .update(body + timestamp)
        .digest('hex');

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/webhooks/post/published',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
            },
            body: body,
        },
    );

    this.article = await response.json();
});

Then('the article is in my followers feeds', async function () {
    const feeds = await Promise.all([
        fetchActivityPub(
            'https://alice.test/.ghost/activitypub/v1/feed/reader',
            { method: 'GET' },
        ),
        fetchActivityPub('https://bob.test/.ghost/activitypub/v1/feed/reader', {
            method: 'GET',
        }),
        fetchActivityPub(
            'https://carol.test/.ghost/activitypub/v1/feed/reader',
            { method: 'GET' },
        ),
    ]);

    const articleId = this.article.id;

    for (const feed of feeds) {
        const json = await feed.json();
        assert(
            json.posts.find((post) => post.id === articleId),
            'Article is not in feed',
        );
    }
});

When('I create a note which mentions alice', async function () {
    const body = JSON.stringify({
        content: 'Hey @index@alice.test!',
    });

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/actions/note',
        {
            method: 'POST',
            body: body,
        },
    );

    const json = await response.json();

    this.note = json.post;
});

Then('the note is in my followers feeds', async function () {
    const feeds = await Promise.all([
        fetchActivityPub(
            'https://alice.test/.ghost/activitypub/v1/feed/notes',
            { method: 'GET' },
        ),
        fetchActivityPub('https://bob.test/.ghost/activitypub/v1/feed/notes', {
            method: 'GET',
        }),
        fetchActivityPub(
            'https://carol.test/.ghost/activitypub/v1/feed/notes',
            { method: 'GET' },
        ),
    ]);

    const noteId = this.note.id;

    for (const feed of feeds) {
        const json = await feed.json();
        assert(
            json.posts.find((post) => post.id === noteId),
            'Note is not in feed',
        );
    }
});

Then('alice recieves a mention notification', async function () {
    const notifications = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/notifications',
        { method: 'GET' },
    );
    const json = await notifications.json();
    assert(
        json.notifications.find(
            (notification) =>
                notification.type === 'mention' &&
                notification.post.id === this.note.id,
        ),
        'Notification is not in notifications',
    );
});

When('I create a reply to alice', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

Then('the reply is not in my followers feeds', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

Then('alice recieves a reply notification', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

When('I delete a note', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

Then('the note is not in my followers feeds', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

When('I like alices note', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

Then('alice recieves a like notification', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

When('I repost alices note', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});

Then('alice recieves a repost notification', async () => {
    // Write code here that turns the phrase above into concrete actions
    return 'pending';
});
