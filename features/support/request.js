import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

import { wait } from './utils.js';
import { getExternalActivityPub } from './wiremock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function fetchActivityPub(url, options = {}, auth = true) {
    if (!options.headers) {
        options.headers = {};
    }

    const privateKey = fs.readFileSync(
        resolve(__dirname, '../fixtures/private.key'),
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
    step = 100,
    milliseconds = 1000,
) {
    const externalActivityPub = getExternalActivityPub();

    const calls = await externalActivityPub.getRequestsForAPI(method, path);
    const found = calls.find(matcher);

    if (found) {
        return found;
    }

    if (milliseconds <= 0) {
        return null;
    }

    await wait(step);

    return waitForRequest(method, path, matcher, step, milliseconds - step);
}
