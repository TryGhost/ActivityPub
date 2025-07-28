import { fetchActivityPub } from './request.js';

export async function waitForItemInFeed(
    itemId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/feed/notes',
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
            `Max retries reached when waiting on item ${itemId} in the feed`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForItemInFeed(itemId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

export async function waitForAPObjectInFeed(
    objectId,
    options = {
        retryCount: 0,
        delay: 0,
    },
    feedUrl = 'https://self.test/.ghost/activitypub/v1/feed/notes',
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(feedUrl, {
        headers: {
            Accept: 'application/ld+json',
        },
    });

    const json = await response.json();

    const found = json.posts.find((item) => {
        return item.url === objectId;
    });

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached when waiting on item ${objectId} in the feed`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForAPObjectInFeed(objectId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
