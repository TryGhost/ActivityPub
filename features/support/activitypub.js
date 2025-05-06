import { fetchActivityPub } from './request.js';

export async function waitForInboxActivity(
    activity,
    object = null,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const response = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/inbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const inbox = await response.json();

    if (
        inbox.items.find((item) => {
            const activityFound = item.id === activity.id;

            if (object) {
                return activityFound && item.object.id === object.id;
            }

            return activityFound;
        })
    ) {
        return;
    }

    if (options.retryCount === MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting on an activity in the inbox`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    await waitForInboxActivity(activity, object, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}

export async function findInOutbox(activity) {
    const initialResponse = await fetchActivityPub(
        'http://fake-ghost-activitypub.test/.ghost/activitypub/outbox/index',
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
    );
    const initialResponseJson = await initialResponse.json();
    const firstPageReponse = await fetchActivityPub(initialResponseJson.first, {
        headers: {
            Accept: 'application/ld+json',
        },
    });
    const outbox = await firstPageReponse.json();

    return (outbox.orderedItems || []).find((item) => item.id === activity.id);
}

export async function waitForOutboxActivity(
    activity,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;
    const found = await findInOutbox(activity);

    if (found) {
        return found;
    }

    if (options.retryCount >= MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting on an activity in the outbox`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    await waitForOutboxActivity(activity, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
