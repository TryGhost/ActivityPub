import { Given, Then, When } from '@cucumber/cucumber';

import assert from 'node:assert';
import { createHmac } from 'node:crypto';

import { waitForAPObjectInFeed, waitForItemInFeed } from '../support/feed.js';
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
            'https://charlie.test/.ghost/activitypub/v1/actions/follow/@index@self.test',
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
    this.originalGhostPost = createWebhookPost();
    const body = JSON.stringify(this.originalGhostPost);
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
    const feeds = await Promise.allSettled([
        waitForItemInFeed(
            this.article.id,
            'https://alice.test/.ghost/activitypub/v1/feed/reader',
        ),
        waitForItemInFeed(
            this.article.id,
            'https://bob.test/.ghost/activitypub/v1/feed/reader',
        ),
        waitForItemInFeed(
            this.article.id,
            'https://charlie.test/.ghost/activitypub/v1/feed/reader',
        ),
    ]);

    assert(
        feeds.every((feed) => feed.status === 'fulfilled'),
        'Article is not in all feeds',
    );
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
    const feeds = await Promise.allSettled([
        waitForAPObjectInFeed(
            this.note.id,
            'https://alice.test/.ghost/activitypub/v1/feed/notes',
        ),
        waitForAPObjectInFeed(
            this.note.id,
            'https://bob.test/.ghost/activitypub/v1/feed/notes',
        ),
        waitForAPObjectInFeed(
            this.note.id,
            'https://charlie.test/.ghost/activitypub/v1/feed/notes',
        ),
    ]);

    assert(
        feeds.every((feed) => feed.status === 'fulfilled'),
        'Note is not in all feeds',
    );
});

Then('alice receives a mention notification', async function () {
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

When('I create a reply to alice', async function () {
    const aliceNoteResponse = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/actions/note',
        {
            method: 'POST',
            body: JSON.stringify({
                content: 'Hello from Alice!',
            }),
        },
    );
    const aliceNoteJson = await aliceNoteResponse.json();
    this.aliceNote = aliceNoteJson.post;

    const replyResponse = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/reply/${encodeURIComponent(this.aliceNote.id)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: 'This is a reply to Alice!',
            }),
        },
    );

    const replyJson = await replyResponse.json();
    this.replyId = replyJson.object.id;
});

Then('the reply is not in my followers feeds', async function () {
    const feeds = await Promise.all([
        fetchActivityPub(
            'https://alice.test/.ghost/activitypub/v1/feed/notes',
            { method: 'GET' },
        ),
        fetchActivityPub('https://bob.test/.ghost/activitypub/v1/feed/notes', {
            method: 'GET',
        }),
        fetchActivityPub(
            'https://charlie.test/.ghost/activitypub/v1/feed/notes',
            { method: 'GET' },
        ),
    ]);

    const replyId = this.replyId;

    for (const feed of feeds) {
        const json = await feed.json();
        assert(
            !json.posts.find((post) => post.id === replyId),
            'Reply should not be in feed',
        );
    }
});

Then('alice receives a reply notification', async function () {
    const notifications = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/notifications',
        { method: 'GET' },
    );
    const json = await notifications.json();
    assert(
        json.notifications.find(
            (notification) =>
                notification.type === 'reply' &&
                notification.post.id === this.replyId,
        ),
        'Reply notification is not in notifications',
    );
});

When('I delete a note', async function () {
    const noteResponse = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/actions/note',
        {
            method: 'POST',
            body: JSON.stringify({
                content: 'This note will be deleted',
            }),
        },
    );
    const noteJson = await noteResponse.json();
    this.note = noteJson.post;

    const deleteResponse = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/post/${encodeURIComponent(this.note.id)}`,
        {
            method: 'DELETE',
        },
    );

    assert.strictEqual(
        deleteResponse.status,
        204,
        'Delete request should return 204',
    );
});

Then('the note is not in my followers feeds', async function () {
    const feeds = await Promise.all([
        fetchActivityPub(
            'https://alice.test/.ghost/activitypub/v1/feed/notes',
            { method: 'GET' },
        ),
        fetchActivityPub('https://bob.test/.ghost/activitypub/v1/feed/notes', {
            method: 'GET',
        }),
        fetchActivityPub(
            'https://charlie.test/.ghost/activitypub/v1/feed/notes',
            { method: 'GET' },
        ),
    ]);

    const noteId = this.note.id;

    for (const feed of feeds) {
        const json = await feed.json();
        assert(
            !json.posts.find((post) => post.id === noteId),
            'Note should not be in feed',
        );
    }
});

When('I like alices note', async function () {
    const aliceNoteResponse = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/actions/note',
        {
            method: 'POST',
            body: JSON.stringify({
                content: 'Alice note to be liked',
            }),
        },
    );
    const aliceNoteJson = await aliceNoteResponse.json();
    this.aliceLikedNote = aliceNoteJson.post;

    const likeResponse = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/like/${encodeURIComponent(this.aliceLikedNote.id)}`,
        {
            method: 'POST',
        },
    );

    assert.strictEqual(
        likeResponse.status,
        200,
        'Like request should return 200',
    );
});

Then('alice receives a like notification', async function () {
    const notifications = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/notifications',
        { method: 'GET' },
    );
    const json = await notifications.json();
    assert(
        json.notifications.find(
            (notification) =>
                notification.type === 'like' &&
                notification.post.id === this.aliceLikedNote.id,
        ),
        'Like notification is not in notifications',
    );
});

When('I repost alices note', async function () {
    const aliceNoteResponse = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/actions/note',
        {
            method: 'POST',
            body: JSON.stringify({
                content: 'Alice note to be reposted',
            }),
        },
    );
    const aliceNoteJson = await aliceNoteResponse.json();
    this.note = aliceNoteJson.post;

    const repostResponse = await fetchActivityPub(
        `https://self.test/.ghost/activitypub/v1/actions/repost/${encodeURIComponent(this.note.id)}`,
        {
            method: 'POST',
        },
    );

    assert.strictEqual(
        repostResponse.status,
        200,
        'Repost request should return 200',
    );
});

When('I update my account information', async function () {
    const updateData = {
        name: 'Updated User Name',
        bio: 'Updated bio description',
        username: 'updatedusername',
        avatarUrl: 'https://example.com/avatar.jpg',
        bannerImageUrl: 'https://example.com/banner.jpg',
    };

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/account',
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
        },
    );

    assert.strictEqual(
        response.status,
        200,
        'Account update request should return 200',
    );

    this.updatedAccountData = updateData;
});

Then('alice can view my updated account information', async function () {
    const response = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/account/@index@self.test',
        { method: 'GET' },
    );

    assert.strictEqual(
        response.status,
        200,
        'Account retrieval should return 200',
    );

    const accountData = await response.json();

    assert.strictEqual(
        accountData.name,
        this.updatedAccountData.name,
        'Account name should be updated',
    );
    assert.strictEqual(
        accountData.bio,
        this.updatedAccountData.bio,
        'Account bio should be updated',
    );
});

Then('alice receives a repost notification', async function () {
    const notifications = await fetchActivityPub(
        'https://alice.test/.ghost/activitypub/v1/notifications',
        { method: 'GET' },
    );
    const json = await notifications.json();
    assert(
        json.notifications.find(
            (notification) =>
                notification.type === 'repost' &&
                notification.post.id === this.note.id,
        ),
        'Repost notification is not in notifications',
    );
});

When('I update the post in ghost', async function () {
    // Use the original ghost post data and update the fields
    const updatedPostData = {
        ...this.originalGhostPost,
        post: {
            current: {
                ...this.originalGhostPost.post.current,
                title: 'Updated Article Title',
                html: '<p>This is the updated content of the article.</p>',
                excerpt: 'Updated excerpt for the article',
            },
        },
    };

    const body = JSON.stringify(updatedPostData);
    const timestamp = Date.now();
    const hmac = createHmac('sha256', getWebhookSecret())
        .update(body + timestamp)
        .digest('hex');

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/webhooks/post/updated',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghost-Signature': `sha256=${hmac}, t=${timestamp}`,
            },
            body: body,
        },
    );

    assert.strictEqual(
        response.status,
        200,
        'Post update webhook should return 200',
    );

    this.updatedPostData = updatedPostData.post.current;
});

Then('the updated article is in my followers feeds', async function () {
    const feeds = await Promise.all([
        fetchActivityPub(
            'https://alice.test/.ghost/activitypub/v1/feed/reader',
            { method: 'GET' },
        ),
        fetchActivityPub('https://bob.test/.ghost/activitypub/v1/feed/reader', {
            method: 'GET',
        }),
        fetchActivityPub(
            'https://charlie.test/.ghost/activitypub/v1/feed/reader',
            { method: 'GET' },
        ),
    ]);

    const articleId = this.article.id;

    for (const feed of feeds) {
        const json = await feed.json();
        const updatedArticle = json.posts.find((post) => post.id === articleId);
        assert(updatedArticle, 'Updated article is not in feed');

        assert.strictEqual(
            updatedArticle.title,
            this.updatedPostData.title,
            'Article title should be updated in feed',
        );

        assert.strictEqual(
            updatedArticle.content,
            this.updatedPostData.html,
            'Article html should be updated in feed',
        );

        assert.strictEqual(
            updatedArticle.excerpt,
            this.updatedPostData.excerpt,
            'Article html should be updated in feed',
        );
    }
});
