import { Given, When } from '@cucumber/cucumber';

import { getClient } from '../support/db.js';
import { fetchActivityPub } from '../support/request.js';

Given('there is no entry in the sites table', async function () {
    await getClient()('sites').del();

    this.SITE_ID = null;
});

When('we request the site endpoint', async function () {
    this.response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/v1/site',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});
