import { Given, When } from '@cucumber/cucumber';

import { getClient } from '../support/db.js';
import { fetchActivityPub } from '../support/request.js';

Given('there is no entry in the sites table', async function () {
    await getClient()('sites').del();

    this.SITE_ID = null;
});

When('we request the site endpoint', async function () {
    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/site',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
});

When('we disable the site', async function () {
    this.response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/site',
        {
            method: 'DELETE',
        },
    );
});
