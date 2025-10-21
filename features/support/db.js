import Knex from 'knex';

/** @type {import('knex').Knex} */
let client;

export function getClient() {
    if (!client) {
        client = Knex({
            client: 'mysql2',
            connection: {
                host: process.env.MYSQL_HOST,
                port: Number.parseInt(process.env.MYSQL_PORT, 10),
                user: process.env.MYSQL_USER,
                password: process.env.MYSQL_PASSWORD,
                database: process.env.MYSQL_DATABASE,
                timezone: '+00:00',
            },
        });
    }

    return client;
}

export async function reset() {
    const db = getClient();

    const tables = [
        'account_delivery_backoffs',
        'accounts',
        'blocks',
        'bluesky_integration_account_handles',
        'domain_blocks',
        'feeds',
        'follows',
        'ghost_ap_post_mappings',
        'key_value',
        'likes',
        'mentions',
        'notifications',
        'outboxes',
        'posts',
        'reposts',
        'sites',
        'users',
    ];

    await db.transaction(async (trx) => {
        await trx.raw('SET FOREIGN_KEY_CHECKS = 0');

        try {
            for (const table of tables) {
                await trx(table).truncate();
            }
        } finally {
            await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
        }
    });
}

export async function createGlobalFeedUser() {
    const db = getClient();

    await db.transaction(async (trx) => {
        const [siteId] = await trx('sites').insert({
            host: 'ap-global-feed.ghost.io',
            webhook_secret: trx.raw(
                "LOWER(SHA2('ap-global-feed.ghost.io', 256))",
            ),
            ghost_pro: 1,
        });

        const [accountId] = await trx('accounts').insert({
            username: 'index',
            name: 'ActivityPub Global Feed',
            bio: 'ActivityPub Global Feed',
            avatar_url: null,
            banner_image_url: null,
            url: 'https://ap-global-feed.ghost.io/',
            custom_fields: null,
            ap_id: 'https://ap-global-feed.ghost.io/.ghost/activitypub/users/index',
            ap_inbox_url:
                'https://ap-global-feed.ghost.io/.ghost/activitypub/inbox/index',
            ap_shared_inbox_url: null,
            ap_public_key: null,
            ap_private_key: null,
            ap_outbox_url:
                'https://ap-global-feed.ghost.io/.ghost/activitypub/outbox/index',
            ap_following_url:
                'https://ap-global-feed.ghost.io/.ghost/activitypub/following/index',
            ap_followers_url:
                'https://ap-global-feed.ghost.io/.ghost/activitypub/followers/index',
            ap_liked_url:
                'https://ap-global-feed.ghost.io/.ghost/activitypub/liked/index',
            uuid: trx.raw('UUID()'),
            domain: 'ap-global-feed.ghost.io',
        });

        await trx('users').insert({
            account_id: accountId,
            site_id: siteId,
        });
    });
}
