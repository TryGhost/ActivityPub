import fs from 'node:fs';
import { resolve } from 'node:path';

import jwt from 'jsonwebtoken';

import { getCurrentDirectory } from './path.js';
import { wait } from './utils.js';
import { getExternalWiremock } from './wiremock.js';

export async function fetchActivityPub(url, options = {}, auth = true) {
    if (!options.headers) {
        options.headers = {};
    }

    const privateKey = fs.readFileSync(
        resolve(getCurrentDirectory(), '../fixtures/private.key'),
    );

    const token = jwt.sign(
        {
            sub: 'test@user.com',
            role: 'Owner',
        },
        privateKey,
        {
            algorithm: 'RS256',
            keyid: 'test-key-id',
            expiresIn: '5m',
        },
    );

    if (auth) {
        options.headers.Authorization = `Bearer ${token}`;
    }

    return fetch(url, options);
}

export async function waitForRequest(
    method,
    path,
    matcher,
    milliseconds = 1000,
    step = 100,
) {
    const externalActivityPub = getExternalWiremock();

    const calls = await externalActivityPub.getRequestsForAPI(method, path);
    const found = calls.find(matcher);

    if (found) {
        return found;
    }

    if (milliseconds <= 0) {
        return null;
    }

    await wait(step);

    return waitForRequest(method, path, matcher, milliseconds - step, step);
}
