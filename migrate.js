// Run the script like this:
// DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD=root DB_NAME=activitypub node migrate.js

// Keep row 25 as the SQL lookup if you're operating on the production DB, otherwise grab a copy of
// the data into a JSON file by uncommenting the fs.writeFileSync line and running the script again.

import knex from 'knex';
import fs from 'node:fs';
import { strict as assert } from 'node:assert';

const db = knex({
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        port: process.env.DB_PORT || 3306,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
    },
});

(async () => {
    try {
        const rows = await db('key_value').select('*');
        //fs.writeFileSync('./rows.json', JSON.stringify(rows, null, 2));

        //const rows = JSON.parse(fs.readFileSync('./rows.json', 'utf8'));

        let followerCount = 0;
        let followingCount = 0;
        const follows = [];
        const accountInfo = new Map();

        const privateKeys = new Map();
        const publicKeys = new Map();

        const logging = false;

        function fetchProperId(account) {
            if (account.startsWith('https://')) {
                return account;
            }

            // It's likely a Ghost site so we should add the index
            return `https://${account}/.ghost/activitypub/users/index`;
        }

        for (const row of rows) {
            const parsedKey = JSON.parse(row.key);

            if (parsedKey.length === 3) {
                if (
                    parsedKey[0] === '_fedify' &&
                    [
                        'publicKey',
                        'privateKey',
                        'activityIdempotence',
                        'remoteDocument',
                    ].includes(parsedKey[1])
                ) {
                    continue;
                }

                const [sites, account, key] = parsedKey;
                assert.equal(sites, 'sites', `parsedKey: ${parsedKey}`);

                if (key === 'followers') {
                    // [sites, account, followers]
                    if (account === 'allou.is') {
                        // Ignore allou.is followers
                        continue;
                    }

                    // For some reason, some followers are duplicated
                    for (const follower of [...new Set(row.value)]) {
                        if (logging) {
                            console.log(account, '<-', follower);
                        }
                        followerCount++;
                        follows.push([
                            fetchProperId(follower),
                            fetchProperId(account),
                        ]);
                    }
                } else if (key === 'following') {
                    // [sites, account, following]
                    // For some reason, some followings are duplicated
                    for (const following of [...new Set(row.value)]) {
                        if (logging) {
                            console.log(account, '->', following);
                        }
                        followingCount++;
                        follows.push([
                            fetchProperId(account),
                            fetchProperId(following),
                        ]);
                    }
                } else {
                    // Ignore other keys
                }
            } else if (parsedKey.length === 4) {
                if (
                    parsedKey[0] === '_fedify' &&
                    ['activityIdempotence'].includes(parsedKey[1])
                ) {
                    continue;
                }

                const [sites, account, key, expanded] = parsedKey;
                assert.equal(sites, 'sites', `parsedKey: ${parsedKey}`);

                if (key === 'followers') {
                    // [sites, account, followers, expanded]
                    assert.equal(expanded, 'expanded');

                    for (const account of row.value) {
                        // I think we're OK to override the account info because the later ones will be more recent
                        accountInfo.set(account.id, account);
                    }
                } else if (key === 'handle') {
                    // [sites, account, handle, expanded]
                    assert.equal(expanded, 'index');

                    accountInfo.set(fetchProperId(account), row.value);
                } else if (key === 'keypair') {
                    privateKeys.set(
                        fetchProperId(account),
                        JSON.stringify(row.value.privateKey),
                    );

                    publicKeys.set(
                        fetchProperId(account),
                        JSON.stringify(row.value.publicKey),
                    );
                } else {
                    console.log(parsedKey);
                }
            } else {
                // Ignore https://... keys for now but print out any I don't know about
                if (parsedKey[0].startsWith('https')) {
                    if (row.value.type === 'Person') {
                        accountInfo.set(parsedKey[0], row.value);
                    } else if (row.value.actor?.type === 'Person') {
                        accountInfo.set(parsedKey[0], row.value.actor);
                        if (row.value.actor.publicKey) {
                            if (!publicKeys.has(row.value.actor.id)) {
                                publicKeys.set(
                                    row.value.actor.id,
                                    row.value.actor.publicKey.publicKeyPem,
                                );
                            }
                        }
                    } else if (typeof row.value.actor === 'string') {
                        // String-based ID, ignore for now
                    } else {
                        if (
                            [
                                'Article',
                                'Note',
                                'Question',
                                'Service',
                                'Application',
                                'Page',
                                'Group',
                                'Create',
                                'Follow',
                            ].includes(row.value.type)
                        ) {
                            continue;
                        }

                        console.log(parsedKey, row.value);
                    }
                } else {
                    console.log(parsedKey);
                }
            }
        }

        const uniqueFollows = Array.from(
            new Set(follows.map(JSON.stringify)), // Convert each sub-array to a string
            JSON.parse, // Convert back to arrays
        );

        const uniqueAccounts = [
            ...new Set(
                uniqueFollows.flatMap((follow) => [follow[0], follow[1]]),
            ),
        ];

        console.log('followerCount', followerCount);
        console.log('followingCount', followingCount);
        console.log('-----------');
        console.log('total follows to insert', uniqueFollows.length);
        console.log('-----------');
        console.log('total unique accounts we found', uniqueAccounts.length);

        const accountsToInsert = [];
        for (const acc of uniqueAccounts) {
            if (!accountInfo.has(acc)) {
                console.log('account not found', acc);
                const lookupActor = rows.find(
                    (row) => row.key === JSON.stringify([acc]),
                );
                if (lookupActor) {
                    accountInfo.set(acc, lookupActor.value);
                } else {
                    console.log('account still not found', acc);
                    continue;
                }
            }

            const account = accountInfo.get(acc);

            const accountToInsert = {
                name: null,
                username: null,
                bio: null,
                avatar_url: null,
                banner_image_url: null,
                url: null,

                custom_fields: null,

                ap_id: null,
                ap_inbox_url: null,
                ap_outbox_url: null,
                ap_following_url: null,
                ap_followers_url: null,
                ap_liked_url: null,
                ap_shared_inbox_url: null,
                ap_public_key: null,
                ap_private_key: null,
            };

            if (account.name) {
                accountToInsert.name = account.name;
            } else if (account.nameMap?.und) {
                accountToInsert.name = account.nameMap.und;
            }

            if (typeof account.preferredUsername === 'string') {
                accountToInsert.username = account.preferredUsername;
            } else if (account.preferredUsername?.['@value']) {
                accountToInsert.username = account.preferredUsername['@value'];
            } else {
                assert.fail(`account.preferredUsername is missing for ${acc}`);
            }

            if (account.summary || account.summary === '') {
                accountToInsert.bio = account.summary;
            } else if (account.summaryMap?.und) {
                accountToInsert.bio = account.summaryMap.und;
            }

            if (typeof account.icon === 'string') {
                accountToInsert.avatar_url = account.icon;
            } else if (account.icon?.url) {
                accountToInsert.avatar_url = account.icon.url;
            }

            if (typeof account.image === 'string') {
                accountToInsert.banner_image_url = account.image;
            } else if (account.image?.url) {
                accountToInsert.banner_image_url = account.image.url;
            }

            if (typeof account.url === 'string') {
                accountToInsert.url = account.url;
            } else if (Array.isArray(account.url)) {
                accountToInsert.url = account.url[0];
            } else if (account.id) {
                accountToInsert.url = account.id;
            } else {
                console.log(account);
                assert.fail(`account.url is missing for ${acc}`);
            }

            if (account.attachment) {
                if (Array.isArray(account.attachment)) {
                    accountToInsert.custom_fields = account.attachment
                        .filter(
                            (attachment) => attachment.type === 'PropertyValue',
                        )
                        .reduce((acc, attachment) => {
                            const keyName =
                                attachment.name || attachment.nameMap?.und;
                            const value =
                                typeof attachment.value === 'string'
                                    ? attachment.value
                                    : attachment.value['@value'];

                            acc[keyName] = value;
                            return acc;
                        }, {});
                } else {
                    if (account.attachment.type === 'PropertyValue') {
                        accountToInsert.custom_fields = {
                            [account.attachment.name]:
                                typeof account.attachment.value === 'string'
                                    ? account.attachment.value
                                    : account.attachment.value['@value'],
                        };
                    }
                }
            }

            if (account.id) {
                accountToInsert.ap_id = account.id;
            } else {
                assert.fail(`account.id is missing for ${acc}`);
            }

            if (account.inbox) {
                accountToInsert.ap_inbox_url = account.inbox;
            } else {
                assert.fail(`account.inbox is missing for ${acc}`);
            }

            if (typeof account.outbox === 'string') {
                accountToInsert.ap_outbox_url = account.inbox;
            } else {
                assert.fail(`account.outbox is missing for ${acc}`);
            }

            if (typeof account.following === 'string') {
                accountToInsert.ap_following_url = account.inbox;
            } else {
                assert.fail(`account.following is missing for ${acc}`);
            }

            if (typeof account.followers === 'string') {
                accountToInsert.ap_followers_url = account.inbox;
            } else {
                assert.fail(`account.followers is missing for ${acc}`);
            }

            if (typeof account.liked === 'string') {
                accountToInsert.ap_liked_url = account.inbox;
            } else {
                assert.fail(`account.liked is missing for ${acc}`);
            }

            if (account.endpoints?.sharedInbox) {
                accountToInsert.ap_shared_inbox_url =
                    account.endpoints.sharedInbox;
            }

            if (publicKeys.has(acc)) {
                accountToInsert.ap_public_key = publicKeys.get(acc);
            } else if (typeof account.publicKey === 'string') {
                accountToInsert.ap_public_key = account.publicKey;
            } else if (account.publicKey?.publicKeyPem) {
                accountToInsert.ap_public_key = account.publicKey.publicKeyPem;
            } else if (account['https://w3id.org/security#publicKeyPem']) {
                accountToInsert.ap_public_key =
                    account['https://w3id.org/security#publicKeyPem'];
            } else {
                const lookupActor = rows.find(
                    (row) => row.key === JSON.stringify([acc]),
                );
                if (lookupActor?.value.publicKey.publicKeyPem) {
                    accountToInsert.ap_public_key =
                        lookupActor.value.publicKey.publicKeyPem;
                } else {
                    assert.fail(`public key is missing for ${acc}`);
                }
            }

            if (privateKeys.has(acc)) {
                accountToInsert.ap_private_key = privateKeys.get(acc);
            }

            accountsToInsert.push(accountToInsert);
        }

        const accountToIdMapping = {};

        if (true) {
            await db.raw('SET FOREIGN_KEY_CHECKS = 0');
            await db('accounts').truncate();
            await db('follows').truncate();
            await db('users').truncate();
            await db.raw('SET FOREIGN_KEY_CHECKS = 1');

            // Insert all the accounts
            console.log('accountsToInsert', accountsToInsert.length);
            for (const account of accountsToInsert) {
                try {
                    const [id] = await db('accounts').insert(account);
                    accountToIdMapping[account.ap_id] = id;
                } catch (error) {
                    console.error('Error inserting account:', error);
                    console.log(account);
                    process.exit(1);
                }
            }

            console.log('Inserted all accounts');

            const followsToInsert = uniqueFollows
                .map((follow) => {
                    const followerId = accountToIdMapping[follow[0]];
                    const followingId = accountToIdMapping[follow[1]];

                    if (!followerId || !followingId) {
                        console.log(
                            'skipping',
                            followerId,
                            followingId,
                            follow,
                        );
                        return null;
                    }

                    return {
                        follower_id: followerId,
                        following_id: followingId,
                    };
                })
                .filter(Boolean);

            await db('follows').insert(followsToInsert);

            console.log('Inserted all follows');

            const sitesInDB = await db('sites').select('*');
            console.log('sitesInDB', sitesInDB.length);

            for (const account of accountsToInsert) {
                const accountDomain = new URL(account.url).hostname;

                const site = sitesInDB.find(
                    (site) => site.host === accountDomain,
                );
                if (site) {
                    await db('users').insert({
                        account_id: accountToIdMapping[account.ap_id],
                        site_id: site.id,
                    });
                }
            }
        }
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await db.destroy();
    }
})();
