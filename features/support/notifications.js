import { fetchActivityPub } from './request.js';

export async function waitForItemInNotifications(
    itemId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/notifications',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const json = await response.json();

    const found = json.notifications.find((notificiation) => {
        return notificiation.post?.id === itemId;
    });

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting on item ${itemId} in the feed`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForItemInNotifications(itemId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
