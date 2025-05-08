import assert from 'node:assert';

import { Then, When } from '@cucumber/cucumber';

import { fetchActivityPub } from '../support/request.js';

When('we like the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/like/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

When('we unlike the object {string}', async function (name) {
    const id = this.objects[name].id;
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test/.ghost/activitypub/actions/unlike/${encodeURIComponent(id)}`,
        {
            method: 'POST',
        },
    );
});

Then('the object {string} should be liked', async function (name) {
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

    assert(found.object.liked === true);
});

Then('the object {string} should not be liked', async function (name) {
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

    assert(found.object.liked !== true);
});
