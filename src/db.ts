import crypto from 'node:crypto';
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
    key: string,
    left_id: number,
    actor_id: string,
    activity_type: string,
    object_type: string,
    reply_object_url: string,
    reply_object_name: string
}

export async function getSite(host: string) {
    const rows = await client.select('*').from('sites').where({host});

    if (!rows || !rows.length) {
        const webhook_secret = crypto.randomBytes(32).toString('hex');
        await client.insert({host, webhook_secret}).into('sites');

        return {
            host,
            webhook_secret
        };
    }

    if (rows.length > 1) {
        throw new Error(`More than one row found for site ${host}`)
    }

    return {
        host: rows[0].host,
        webhook_secret: rows[0].webhook_secret
    };
}

// Helper function to get the meta data for an array of activity URIs
// from the database. This allows us to fetch information about the activities
// without having to fetch the full activity object. This is a bit of a hack to
// support sorting / filtering of the activities and should be replaced when we
// have a proper db schema
export async function getActivityMeta(uris: string[]): Promise<Map<string, ActivityMeta>> {
    const results = await client
        .select(
            'left.key',
            'left.id as left_id',
            // mongo schmongo...
            client.raw('JSON_EXTRACT(left.value, "$.actor.id") as actor_id'),
            client.raw('JSON_EXTRACT(left.value, "$.type") as activity_type'),
            client.raw('JSON_EXTRACT(left.value, "$.object.type") as object_type'),
            client.raw('JSON_EXTRACT(right.value, "$.object.url") as reply_object_url'),
            client.raw('JSON_EXTRACT(right.value, "$.object.name") as reply_object_name')
        )
        .from({ left: 'key_value' })
        // @ts-ignore: This works as expected but the type definitions complain 🤔
        .leftJoin(
            { right: 'key_value' },
            client.raw('JSON_UNQUOTE(JSON_EXTRACT(right.value, "$.object.id"))'),
            '=',
            client.raw('JSON_UNQUOTE(JSON_EXTRACT(left.value, "$.object.inReplyTo"))')
        )
        .whereIn('left.key', uris.map(uri => `["${uri}"]`));

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

export async function getActivityThreadChildren(id: string) {
    const results = await client
        .select('value')
        .from('key_value')
        // If inReplyTo is a string
        .where(client.raw(`JSON_EXTRACT(value, "$.object.inReplyTo") = "${id}"`))
        // If inReplyTo is an object
        .orWhere(client.raw(`JSON_EXTRACT(value, "$.object.inReplyTo.id") = "${id}"`));

    return results.map((result) => result.value);
}

export async function getActivityThreadParents(activityObjectId: string) {
    const parents: any[] = [];

    const getParent = async (objectId: string) => {
        const result = await client
            .select('value')
            .from('key_value')
            .where(client.raw(`JSON_EXTRACT(value, "$.object.id") = "${objectId}"`));

        if (result.length === 1) {
            const parent = result[0];

            parents.unshift(parent.value);

            const inReplyToId = parent.value.object.inReplyTo?.id ?? parent.value.object.inReplyTo; // inReplyTo can be a string or an object

            if (inReplyToId) {
                await getParent(inReplyToId);
            }
        }
    };

    await getParent(activityObjectId);

    return parents;
}

export async function getActivityReplyCount(activityObjectId: string) {
    const result = await client
        .count('* as count')
        .from('key_value')
        // If inReplyTo is a string
        .where(client.raw(`JSON_EXTRACT(value, "$.object.inReplyTo") = "${activityObjectId}"`))
        // If inReplyTo is an object
        .orWhere(client.raw(`JSON_EXTRACT(value, "$.object.inReplyTo.id") = "${activityObjectId}"`));

    return result[0].count;
}
