import Knex from 'knex';

/** @type {import('knex').Knex} */
let client;

export function getClient() {
    if (!client) {
        client = Knex({
            client: 'mysql2',
            connection: {
                host: process.env.MYSQL_HOST,
                port: Number.parseInt(process.env.MYSQL_PORT),
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

    await db.raw('SET FOREIGN_KEY_CHECKS = 0');
    await db('key_value').truncate();
    await db('notifications').truncate();
    await db('feeds').truncate();
    await db('blocks').truncate();
    await db('follows').truncate();
    await db('likes').truncate();
    await db('reposts').truncate();
    await db('posts').truncate();
    await db('outboxes').truncate();
    await db('accounts').truncate();
    await db('users').truncate();
    await db.raw('SET FOREIGN_KEY_CHECKS = 1');
}
