import assert from 'node:assert';

import { Then } from '@cucumber/cucumber';

Then('the response contains {string} account details', async function (name) {
    const responseJson = await this.response.clone().json();
    const actor = name === 'Our' ? this.actors.Us : this.actors[name];

    assert.equal(responseJson.apId, actor.id);
    assert.equal(responseJson.name, actor.name);
    assert.equal(responseJson.handle, actor.handle);
    assert.equal(responseJson.url, actor.url);
    assert.equal(responseJson.avatarUrl, actor.icon?.url || '');
    assert.equal(responseJson.bannerImageUrl, actor.image?.url || '');
    assert.equal(typeof responseJson.bio, 'string');
    assert.equal(typeof responseJson.postCount, 'number');
    assert.equal(typeof responseJson.likedCount, 'number');
    assert.equal(typeof responseJson.followingCount, 'number');
    assert.equal(typeof responseJson.followerCount, 'number');
    assert.equal(typeof responseJson.followedByMe, 'boolean');
    assert.equal(typeof responseJson.followsMe, 'boolean');
});

Then('the response contains the account details:', async function (data) {
    const responseJson = await this.response.clone().json();

    for (const [key, value] of Object.entries(data.rowsHash())) {
        assert.equal(
            responseJson[key],
            value,
            `Expected ${key} to be "${value}" but got "${responseJson[key]}"`,
        );
    }
});
