import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Then, When } from '@cucumber/cucumber';

import { getCurrentDirectory } from '../support/path.js';
import { fetchActivityPub } from '../support/request.js';

When(
    /an authenticated (\"(delete|get|post|put)\"\s)?request is made to "(.*)"$/,
    async function (method, path) {
        const requestMethod = method || 'get';
        let requestPath = path;

        // If this is a request to the delete post endpoint, we need to replace the
        // object name with the object ID as we don't have a way to know the object
        // ID ahead of time
        if (requestMethod === 'delete' && path.includes('/post/')) {
            const objectName = path.split('/').pop(); // Object name is the last part of the path

            const object =
                this.objects[objectName] || this.activities[objectName]?.object;

            if (object) {
                requestPath = path.replace(
                    objectName,
                    encodeURIComponent(object.id),
                );
            }
        }

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub.test${requestPath}`,
            {
                method: requestMethod,
                headers: {
                    Accept: 'application/ld+json',
                },
            },
        );
    },
);

When(
    /^an authenticated (\"(post|put)\"\s)?request is made to "(.*)" with the data:$/,
    async function (method, path, data) {
        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub.test${path}`,
            {
                method: method,
                headers: {
                    Accept: 'application/ld+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data.rowsHash()),
            },
        );
    },
);

When(
    /^an authenticated (\"(post|put)\"\s)?request is made to "(.*)" with an image$/,
    async function (method, path) {
        const image = await readFile(
            resolve(getCurrentDirectory(), '../fixtures/dog.jpg'),
        );

        const formData = new FormData();
        formData.append(
            'file',
            new File([image], 'dog.jpg', { type: 'image/jpeg' }),
        );

        this.response = await fetchActivityPub(
            `http://fake-ghost-activitypub.test${path}`,
            {
                method: method || 'post',
                body: formData,
            },
        );
    },
);

When('an unauthenticated request is made to {string}', async function (path) {
    this.response = await fetchActivityPub(
        `http://fake-ghost-activitypub.test${path}`,
        {
            headers: {
                Accept: 'application/ld+json',
            },
        },
        false,
    );
});

Then('the request is rejected', function () {
    assert(!this.response.ok);
});

Then('the request is rejected with a {int}', function (statusCode) {
    assert(
        statusCode < 500,
        `Expected to check for a client error, got a server error ${statusCode}`,
    );
    assert(!this.response.ok);
    assert.equal(this.response.status, statusCode);
});

Then('the request is accepted', async function () {
    assert(
        this.response.ok,
        `Expected OK response - got ${this.response.status} ${await this.response.clone().text()}`,
    );
});

Then('the request is accepted with a {int}', function (statusCode) {
    assert.equal(
        this.response.status,
        statusCode,
        `Expected status code ${statusCode} - got ${this.response.status}`,
    );
});

Then('the response contains a file URL', async function () {
    const responseJson = await this.response.clone().json();
    assert(responseJson.fileUrl, 'Response should contain a fileUrl');
    assert(
        typeof responseJson.fileUrl === 'string',
        'fileUrl should be a string',
    );
    assert(
        responseJson.fileUrl.startsWith('http'),
        'fileUrl should be a valid URL',
    );
});
