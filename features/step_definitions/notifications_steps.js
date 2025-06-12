import assert from 'node:assert';
import { Then, When } from '@cucumber/cucumber';
import { waitForUnreadNotifications } from '../support/notifications.js';
import { fetchActivityPub } from '../support/request.js';

Then('the unread notifications count is {int}', async (count) => {
    const found = await waitForUnreadNotifications(count);
    assert(found);
});

When('we reset unread notifications count', async () => {
    await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/notifications/unread/reset',
        {
            method: 'PUT',
        },
    );
});
