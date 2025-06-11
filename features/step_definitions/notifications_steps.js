import assert from 'node:assert';
import { Then } from '@cucumber/cucumber';

Then('the unread notifications count is {int}', async function (count) {
    const responseJson = await this.response.clone().json();
    assert(
        responseJson.count === count,
        `Expected unread notifications count to be ${count} - got ${responseJson.count}`,
    );
});
