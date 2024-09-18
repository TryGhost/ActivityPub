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
});

await client.schema.createTableIfNotExists('key_value', function (table) {
    table.increments('id').primary();
    table.string('key', 2048);
    table.json('value').notNullable();
    table.datetime('expires').nullable();
});

// Helper function to get the meta data for a list of activity URIs
// from the database. This allows us to fetch information about the activities
// without having to fetch the full activity object. This is a bit of a hack to
// support sorting / filtering of the activities and should be replaced when we
// have a proper db schema
export async function getActivityMeta(uris: string[]): Promise<Map<string, { id: number, type: string }>> {
    const results = await client
        .select('key', 'id', client.raw('JSON_EXTRACT(value, "$.type") as type'))
        .from('key_value')
        .whereIn('key', uris.map(uri => `["${uri}"]`));

    const map = new Map<string, { id: number, type: string }>();

    for (const result of results) {
        map.set(result.key.substring(2, result.key.length - 2), {
            id: result.id,
            type: result.type,
        });
    }

    return map;
}
