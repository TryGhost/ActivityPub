import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import { fetchActivityPub } from '../support/request.js';

When('we repost the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/repost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should be reposted', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const object = this.objects[name];

    const found = inbox.items.find((item) => item.object.id === object.id);

    assert(found.object.reposted === true);
});

Then(
    'the object {string} should have a repost count of {int}',
    async function (name, repostCount) {
        const response = await fetchActivityPub(
            'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
            {
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
        const inbox = await response.json();
        const object = this.objects[name];

        const found = inbox.items.find((item) => item.object.id === object.id);

        assert(found.object.repostCount === repostCount);
    },
);

When('we undo the repost of the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/derepost/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should not be reposted', async function (name) {
    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();
    const object = this.objects[name];
    const found = inbox.items.find((item) => item.object.id === object.id);

    assert(found.object.reposted !== true);
});
