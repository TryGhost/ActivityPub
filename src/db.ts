import Knex from 'knex';

export const client = Knex({
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

interface ActivityJsonLd {
    // TODO: Clean up the any type
    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
    [key: string]: any;
}

/**
 * @deprecated Do not use this function. Instead, resolve the post via the
 * post repository and use the `replyCount` property
 */
export async function getActivityChildrenCount(activity: ActivityJsonLd) {
    const objectId = activity.object.id;

    const result = await client
        .count('* as count')
        .from('key_value')
        .where(function () {
            // If inReplyTo is a string
            this.where(
                client.raw(
                    `JSON_EXTRACT(value, "$.object.inReplyTo") = "${objectId}"`,
                ),
            );

            // If inReplyTo is an object
            this.orWhere(
                client.raw(
                    `JSON_EXTRACT(value, "$.object.inReplyTo.id") = "${objectId}"`,
                ),
            );
        })
        .andWhere(client.raw(`JSON_EXTRACT(value, "$.type") = "Create"`));

    return result[0].count;
}

/**
 * @deprecated Do not use this function. Instead, resolve the post via the
 * post repository and use the `repostCount` property
 */
export async function getRepostCount(activity: ActivityJsonLd) {
    const objectId = activity.object.id;

    const result = await client
        .count('* as count')
        .from('key_value')
        .where(function () {
            this.where(
                client.raw(
                    `JSON_EXTRACT(value, "$.object.id") = "${objectId}"`,
                ),
            );
        })
        .andWhere(client.raw(`JSON_EXTRACT(value, "$.type") = "Announce"`));

    return result[0].count;
}

export async function getRelatedActivities(
    postUrl: string,
): Promise<{ id: string }[]> {
    return client
        .select(client.raw('JSON_EXTRACT(value, "$.id") as id'))
        .from('key_value')
        .where(function () {
            this.where(client.raw('object_id = ?', [postUrl]))
                .orWhere(client.raw('object = ?', [postUrl]))
                .orWhere(client.raw('json_id = ?', [postUrl]));
        }) as unknown as Promise<{ id: string }[]>;
}
