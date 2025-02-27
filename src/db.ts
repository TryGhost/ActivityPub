import Knex from 'knex';

export const client = Knex({
    client: 'mysql2',
    connection: {
        host: process.env.MYSQL_HOST,
        port: Number.parseInt(process.env.MYSQL_PORT!),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    },
    pool: {
        min: 1,
        max: 50,
    },
});

type ActivityMeta = {
    id: number; // Used for sorting
    actor_id: string; // Used for filtering by follower / non-follower status
    activity_type: string; // Used for filtering by activity type
    object_type: string; // Used for filtering by object type
    reply_object_url: string; // Used for filtering by isReplyToOwn criteria
    reply_object_name: string; // Used for filtering by isReplyToOwn criteria
};

type getActivityMetaQueryResult = {
    key: string;
    left_id: number;
    actor_id: string;
    activity_type: string;
    object_type: string;
    reply_object_url: string;
    reply_object_name: string;
};

interface ActivityJsonLd {
    [key: string]: any;
}

// Helper function to get the meta data for an array of activity URIs
// from the database. This allows us to fetch information about the activities
// without having to fetch the full activity object. This is a bit of a hack to
// support sorting / filtering of the activities and should be replaced when we
// have a proper db schema
export async function getActivityMeta(
    uris: string[],
): Promise<Map<string, ActivityMeta>> {
    const results = await client
        .select(
            'left.key',
            'left.id as left_id',
            // mongo schmongo...
            client.raw('JSON_EXTRACT(left.value, "$.actor.id") as actor_id'),
            client.raw('JSON_EXTRACT(left.value, "$.type") as activity_type'),
            client.raw(
                'JSON_EXTRACT(left.value, "$.object.type") as object_type',
            ),
            client.raw(
                'JSON_EXTRACT(right.value, "$.object.url") as reply_object_url',
            ),
            client.raw(
                'JSON_EXTRACT(right.value, "$.object.name") as reply_object_name',
            ),
        )
        .from({ left: 'key_value' })
        // @ts-ignore: This works as expected but the type definitions complain 🤔
        .leftJoin(
            { right: 'key_value' },
            client.raw(
                'JSON_UNQUOTE(JSON_EXTRACT(right.value, "$.object.id"))',
            ),
            '=',
            client.raw(
                'JSON_UNQUOTE(JSON_EXTRACT(left.value, "$.object.inReplyTo"))',
            ),
        )
        .whereIn(
            'left.key',
            uris.map((uri) => `["${uri}"]`),
        );

    const map = new Map<string, ActivityMeta>();

    for (const result of results as getActivityMetaQueryResult[]) {
        map.set(result.key.substring(2, result.key.length - 2), {
            id: result.left_id,
            actor_id: result.actor_id,
            activity_type: result.activity_type,
            object_type: result.object_type,
            reply_object_url: result.reply_object_url,
            reply_object_name: result.reply_object_name,
        });
    }

    return map;
}

// This is a variant of getActivityMeta that does not use a join on itself in
// order to also fetch replies. This is fixes a long standing issue where replies
// are not correctly being fetched. This is used by the new feed endpoint which
// does not need to fetch replies. Why not just update getActivityMeta? That
// method is used by the notifications section of the client which needs replies
// and somehow works around its quirks of them not being correctly fetched :s
// Seeming though this is method is only going to be temporary until we have the
// posts table, I thought it would be easier to do this instead of updating
// getActivityMeta and potentially breaking notifications
export async function getActivityMetaWithoutJoin(
    uris: string[],
): Promise<Map<string, ActivityMeta>> {
    const results = await client
        .select(
            'key',
            'id',
            client.raw('JSON_EXTRACT(value, "$.actor.id") as actor_id'),
            client.raw('JSON_EXTRACT(value, "$.type") as activity_type'),
            client.raw('JSON_EXTRACT(value, "$.object.type") as object_type'),
            client.raw(
                'COALESCE(JSON_EXTRACT(value, "$.object.inReplyTo.id"), JSON_EXTRACT(value, "$.object.inReplyTo")) as reply_object_url',
            ),
        )
        .from('key_value')
        .whereIn(
            'key',
            uris.map((uri) => `["${uri}"]`),
        );

    const map = new Map<string, ActivityMeta>();

    for (const result of results) {
        map.set(result.key.substring(2, result.key.length - 2), {
            id: result.id,
            actor_id: result.actor_id,
            activity_type: result.activity_type,
            object_type: result.object_type,
            reply_object_url: result.reply_object_url,
            reply_object_name: '',
        });
    }

    return map;
}

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
