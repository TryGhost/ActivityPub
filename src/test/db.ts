import { afterAll } from 'vitest';

import { randomBytes } from 'node:crypto';

import knex from 'knex';

/**
 * Creates an empty DB with the activitypub schema.
 * Handles cleanup of connection and DB using afterAll hook.
 */
export async function createTestDb() {
    const systemClient = knex({
        client: 'mysql2',
        connection: process.env.MYSQL_SOCKET_PATH
            ? {
                  socketPath: process.env.MYSQL_SOCKET_PATH,
                  user: process.env.MYSQL_USER,
                  password: process.env.MYSQL_PASSWORD,
                  database: 'mysql',
                  timezone: '+00:00',
              }
            : {
                  host: process.env.MYSQL_HOST,
                  port: Number.parseInt(process.env.MYSQL_PORT!, 10),
                  user: process.env.MYSQL_USER,
                  password: process.env.MYSQL_PASSWORD,
                  database: 'mysql',
                  timezone: '+00:00',
              },
    });

    const dbName = `${process.env.MYSQL_DATABASE?.includes('pr-') ? `${process.env.MYSQL_DATABASE.replace(/-/g, '_')}_` : ''}test_${randomBytes(16).toString('hex')}`;

    await systemClient.raw(`CREATE DATABASE ${dbName}`);

    const tables = await systemClient.raw(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${process.env.MYSQL_DATABASE}'`,
    );

    // Clone each table structure - GCP SQL was having issues with the `CREATE TABLE LIKE` syntax
    for (const { TABLE_NAME } of tables[0]) {
        const [createTableResult] = await systemClient.raw(
            `SHOW CREATE TABLE \`${process.env.MYSQL_DATABASE}\`.\`${TABLE_NAME}\``,
        );
        const createTableSql = createTableResult[0]['Create Table']
            .replace('CREATE TABLE ', `CREATE TABLE \`${dbName}\`.`)
            .split('\n')
            .filter((line: string) => !line.trim().startsWith('CONSTRAINT'))
            .join('\n')
            .replace(/,\n\)/, '\n)'); // clean up trailing comma
        await systemClient.raw(createTableSql);
    }

    await systemClient.destroy();

    const dbClient = knex({
        client: 'mysql2',
        connection: process.env.MYSQL_SOCKET_PATH
            ? {
                  socketPath: process.env.MYSQL_SOCKET_PATH,
                  user: process.env.MYSQL_USER,
                  password: process.env.MYSQL_PASSWORD,
                  database: dbName,
                  timezone: '+00:00',
              }
            : {
                  host: process.env.MYSQL_HOST,
                  port: Number.parseInt(process.env.MYSQL_PORT!, 10),
                  user: process.env.MYSQL_USER,
                  password: process.env.MYSQL_PASSWORD,
                  database: dbName,
                  timezone: '+00:00',
              },
    });

    afterAll(async () => {
        await dbClient.destroy();
        const systemClient = knex({
            client: 'mysql2',
            connection: process.env.MYSQL_SOCKET_PATH
                ? {
                      socketPath: process.env.MYSQL_SOCKET_PATH,
                      user: process.env.MYSQL_USER,
                      password: process.env.MYSQL_PASSWORD,
                      database: 'mysql',
                      timezone: '+00:00',
                  }
                : {
                      host: process.env.MYSQL_HOST,
                      port: Number.parseInt(process.env.MYSQL_PORT!, 10),
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
