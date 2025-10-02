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
