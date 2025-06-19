import { When } from '@cucumber/cucumber';

import { fetchActivityPub } from '../support/request.js';

When('we block {string}', async function (actorName) {
    const actor = this.actors[actorName];

    this.response = await fetchActivityPub(
        `${process.env.URL_GHOST_ACTIVITY_PUB}/.ghost/activitypub/actions/block/${encodeURIComponent(actor.id)}`,
        {
            method: 'POST',
        },
    );
});
