import { randomBytes } from 'node:crypto';
import knex from 'knex';
import { afterAll } from 'vitest';

/**
 * Creates an empty DB with the activitypub schema.
 * Handles cleanup of connection and DB using afterAll hook.
 */
export async function createTestDb() {
    const systemClient = knex({
        client: 'mysql2',
        connection: {
            host: process.env.MYSQL_HOST,
            port: Number.parseInt(process.env.MYSQL_PORT!),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: 'mysql',
            timezone: '+00:00',
        },
    });

    const dbName = `test_${randomBytes(16).toString('hex')}`;

    await systemClient.raw(`CREATE DATABASE ${dbName}`);

    const tables = await systemClient.raw(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${process.env.MYSQL_DATABASE}'`,
    );

    // Clone each table structure
    for (const { TABLE_NAME } of tables[0]) {
        await systemClient.raw(
            `CREATE TABLE ${dbName}.${TABLE_NAME} LIKE ${process.env.MYSQL_DATABASE}.${TABLE_NAME}`,
        );
    }

    await systemClient.destroy();

    const dbClient = knex({
        client: 'mysql2',
        connection: {
            host: process.env.MYSQL_HOST,
            port: Number.parseInt(process.env.MYSQL_PORT!),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: dbName,
            timezone: '+00:00',
            pool: {
                min: 1,
                max: 1,
            },
        },
    });

    afterAll(async () => {
        await dbClient.destroy();
        const systemClient = knex({
            client: 'mysql2',
            connection: {
                host: process.env.MYSQL_HOST,
                port: Number.parseInt(process.env.MYSQL_PORT!),
                user: process.env.MYSQL_USER,
                password: process.env.MYSQL_PASSWORD,
                database: 'mysql',
                timezone: '+00:00',
            },
        });
        await systemClient.raw(`DROP DATABASE ${dbName}`);
        await systemClient.destroy();
    });

    return dbClient;
}
