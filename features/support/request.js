import { getFixtureKey, signToken } from './jwks.js';
import { getExternalWiremock } from './wiremock.js';

export async function fetchActivityPub(url, options = {}, auth = true) {
    if (!options.headers) {
        options.headers = {};
    }

    if (auth) {
        const token = await signToken(await getFixtureKey());
        options.headers.Authorization = `Bearer ${token}`;
    }

    return fetch(url, options);
}

export async function waitForRequest(
    method,
    path,
    matcher,
    options = {
        retryCount: 0,
        delay: 0,
    },
) {
    const MAX_RETRIES = 5;

    const externalActivityPub = getExternalWiremock();

    const calls = await externalActivityPub.getRequestsForAPI(method, path);

    const found = calls.find((call) => {
        try {
            return matcher(call);
        } catch {
            return false;
        }
    });

    if (found) {
        return found;
    }

    if (options.retryCount >= MAX_RETRIES) {
        throw new Error(
            `Max retries reached (${MAX_RETRIES}) when waiting for request ${method} ${path}`,
        );
    }

    if (options.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    return waitForRequest(method, path, matcher, {
        retryCount: options.retryCount + 1,
        delay: options.delay + 500,
    });
}
