import { Given, Then } from '@cucumber/cucumber';

import assert from 'node:assert';

import { fetchActivityPub, waitForRequest } from '../support/request.js';
import { getExternalWiremock } from '../support/wiremock.js';

// Matches RELAY_INBOXES of the activitypub-testing service
const RELAY_INBOX_PATH = '/relay/inbox';

Given('relay sharing is turned on', async () => {
    await getExternalWiremock().register(
        {
            method: 'POST',
            endpoint: RELAY_INBOX_PATH,
        },
        {
            status: 202,
        },
    );

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v2/actions/relay/enable',
        {
            method: 'POST',
        },
    );

    assert.equal(response.status, 204);
});

Then('our account has relay sharing turned on', async () => {
    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/account/me',
    );
    const account = await response.json();

    assert.equal(account.relaySharingEnabled, true);
    assert.deepEqual(account.relayHosts, ['fake-external-activitypub.test']);
});

Then(
    'a {string} activity for {string} is sent to the relay',
    async function (activityType, objectName) {
        const object = this.objects[objectName];

        const request = await waitForRequest(
            'POST',
            RELAY_INBOX_PATH,
            (call) => {
                const json = JSON.parse(call.request.body);

                return (
                    json.type === activityType &&
                    (json.object?.id ?? json.object) === object.id
                );
            },
            {
                retryCount: 0,
                delay: 500,
            },
        );

        assert(request, `${activityType} for "${objectName}" was not sent`);
    },
);
