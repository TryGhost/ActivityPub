import Knex from 'knex';

export const knex = Knex({
    client: 'mysql2',
    connection: process.env.MYSQL_SOCKET_PATH
        ? {
              socketPath: process.env.MYSQL_SOCKET_PATH,
              user: process.env.MYSQL_USER,
              password: process.env.MYSQL_PASSWORD,
              database: process.env.MYSQL_DATABASE,
              timezone: '+00:00',
          }
        : {
              host: process.env.MYSQL_HOST,
              port: Number.parseInt(process.env.MYSQL_PORT!),
              user: process.env.MYSQL_USER,
              password: process.env.MYSQL_PASSWORD,
              database: process.env.MYSQL_DATABASE,
              timezone: '+00:00',
          },
    pool: {
        min: 1,
        max: 200,
    },
});

export async function getRelatedActivities(
    postUrl: string,
): Promise<{ id: string }[]> {
    return knex
        .select(knex.raw('JSON_EXTRACT(value, "$.id") as id'))
        .from('key_value')
        .where(function () {
            this.where(knex.raw('object_id = ?', [postUrl]))
                .orWhere(knex.raw('object = ?', [postUrl]))
                .orWhere(knex.raw('json_id = ?', [postUrl]));
        }) as unknown as Promise<{ id: string }[]>;
}
