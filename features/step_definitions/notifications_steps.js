import assert from 'node:assert';
import { Then } from '@cucumber/cucumber';
import { waitForUnreadNotifications } from '../support/notifications.js';

Then('the unread notifications count is {int}', async (count) => {
    const found = await waitForUnreadNotifications(count);
    assert(found);
});
