import { fetchActivityPub } from './request.js';

export async function waitForFollowerToBeRemoved(
    followerId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/followers/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const followers = await response.json();

    const found = (followers.orderedItems || []).find(
        (item) => item === followerId,
    );

    if (!found) {
        return true;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached when waiting on follower ${followerId} to be removed`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForFollowerToBeRemoved(followerId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

export async function waitForFollowerToBeAdded(
    followerId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'http://self.test/.ghost/activitypub/followers/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const followers = await response.json();

    const found = (followers.orderedItems || []).find(
        (item) => item === followerId,
    );

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached when waiting on follower ${followerId} to be added`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForFollowerToBeAdded(followerId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
