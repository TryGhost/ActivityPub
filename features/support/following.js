import { fetchActivityPub } from './request.js';

export async function waitForFollowingToBeAdded(
    followingId,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'https://self.test/.ghost/activitypub/following/index?cursor=0',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );

    const following = await response.json();

    const found = (following.orderedItems || []).find(
        (item) => item === followingId,
    );

    if (found) {
        return found;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached when waiting on following ${followingId} to be added`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return await waitForFollowingToBeAdded(followingId, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
