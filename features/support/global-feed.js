import { fetchActivityPub } from './request.js';

export async function waitForAPObjectInGlobalFeed(
    objectId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/feed/global',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    const json = await response.json();

    const found = json.posts.find((item) => {
        return item.url === objectId;
    });

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached when waiting on item ${objectId} in the global feed`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForAPObjectInGlobalFeed(objectId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
