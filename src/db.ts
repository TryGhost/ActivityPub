import Knex from 'knex';

export const client = Knex({
    client: 'mysql2',
    connection: {
        host: process.env.MYSQL_HOST,
        port: parseInt(process.env.MYSQL_PORT!),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    },
    pool: {
        min: 2,
        max: 40,
    }
});

await client.schema.createTableIfNotExists('key_value', function (table) {
    table.increments('id').primary();
    table.string('key', 2048);
    table.json('value').notNullable();
    table.datetime('expires').nullable();
});
