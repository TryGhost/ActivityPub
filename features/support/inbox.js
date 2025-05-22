import { fetchActivityPub } from './request.js';

export async function waitForItemInInbox(
    itemId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const json = await response.json();

    const found = json.posts.find((item) => {
        return item.id === itemId;
    });

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting on item ${itemId} in the inbox`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForItemInInbox(itemId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

export async function waitForAPObjectInInbox(
    objectId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const json = await response.json();

    const found = json.posts.find((item) => {
        return item.url === objectId;
    });

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached when waiting on item ${objectId} in the inbox`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForAPObjectInInbox(objectId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
