import { fetchActivityPub } from './request.js';

export async function waitForItemInNotifications(
    input,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    let matcher;
    if (typeof input === 'string') {
        matcher = (notification) => {
            return notification.post?.id === input;
        };
    } else {
        matcher = input;
    }

    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/notifications',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const json = await response.json();

    const found = json.notifications.find((notificiation) => {
        return matcher(notificiation);
    });

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting on item in notifications`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForItemInNotifications(matcher, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

export async function waitForUnreadNotifications(
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/notifications/unread/count',
    );

    const responseJson = await response.clone().json();

    const unreadNotifications = responseJson.count > 0;

    if (unreadNotifications) {
        return true;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting for unread notifications. No unread notifications found.`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForUnreadNotifications({
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

export async function waitForZeroUnreadNotifications(
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/v1/notifications/unread/count',
    );

    const responseJson = await response.clone().json();

    const zeroUnreadNotifications = responseJson.count === 0;

    if (zeroUnreadNotifications) {
        return true;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting for zero unread notifications. Unread notifications found: ${responseJson.count}.`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForZeroUnreadNotifications({
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
