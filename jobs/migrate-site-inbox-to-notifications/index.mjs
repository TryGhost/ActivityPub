import Knex from 'knex';

const db = Knex({
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        timezone: '+00:00',
    },
    pool: {
        min: 0,
        max: 50,
    },
});

const EVENT_TYPE_MAP = {
    Like: 1,
    Repost: 2,
    Reply: 3,
    Follow: 4,
};

async function getKvInbox(siteHost) {
    const inbox = await db('key_value')
        .select('value')
        .where('key', `["sites","${siteHost}","inbox"]`)
        .first();

    if (!inbox) {
        return null;
    }

    return inbox.value;
}

async function getKvJSON(key) {
    const data = await db('key_value')
        .select('value')
        .where('key', `["${key}"]`)
        .first();

    if (!data) {
        return null;
    }

    return data.value;
}

async function getSiteData(host) {
    const site = await db('sites').select('*').where('host', host).first();

    if (!site) {
        throw new Error(`Site not found for host: ${host}`);
    }

    const user = await db('users')
        .select('*')
        .where('site_id', site.id)
        .first();

    if (!user) {
        throw new Error(`User not found for site: ${host}`);
    }

    const account = await db('accounts')
        .select('*')
        .where('id', user.account_id)
        .first();

    if (!account) {
        throw new Error(`Account not found for user: ${user.id}`);
    }

    return { site, user, account };
}

const accountCache = new Map();

async function getAccountByApId(apId) {
    if (accountCache.has(apId)) {
        return accountCache.get(apId);
    }

    const account = await db('accounts')
        .select('*')
        .where('ap_id', apId)
        .first();

    if (!account) {
        return null;
    }

    accountCache.set(apId, account);

    return account;
}

const postCache = new Map();

async function getPostByApId(apId) {
    if (postCache.has(apId)) {
        return postCache.get(apId);
    }

    const post = await db('posts').select('*').where('ap_id', apId).first();

    if (!post) {
        return null;
    }

    postCache.set(apId, post);

    return post;
}

async function processActivity(activity, siteUser, siteAccount) {
    let eventType = null;
    let accountId = null;
    let postId = null;
    let inReplyToPostId = null;

    if (activity.type === 'Like') {
        eventType = EVENT_TYPE_MAP.Like;

        const post = await getPostByApId(
            activity.object?.id || activity.object,
        );
        if (!post || post.author_id !== siteUser.account_id) {
            return null;
        }
        postId = post.id;

        const account = await getAccountByApId(
            activity.actor?.id || activity.actor,
        );
        if (!account) {
            return null;
        }
        accountId = account.id;
    }

    if (activity.type === 'Announce') {
        eventType = EVENT_TYPE_MAP.Repost;

        const post = await getPostByApId(
            activity.object?.id || activity.object,
        );
        if (!post || post.author_id !== siteUser.account_id) {
            return null;
        }
        postId = post.id;

        const account = await getAccountByApId(
            activity.actor?.id || activity.actor,
        );
        if (!account) {
            return null;
        }
        accountId = account.id;
    }

    if (activity.type === 'Create') {
        eventType = EVENT_TYPE_MAP.Reply;

        if (!activity.object.inReplyTo) {
            return null;
        }

        const inReplyToPost = await getPostByApId(
            activity.object.inReplyTo?.id || activity.object.inReplyTo,
        );
        if (!inReplyToPost || inReplyToPost.author_id !== siteUser.account_id) {
            return null;
        }
        inReplyToPostId = inReplyToPost.id;

        const post = await getPostByApId(
            activity.object?.id || activity.object,
        );
        if (!post) {
            return null;
        }
        postId = post.id;

        const account = await getAccountByApId(
            activity.actor?.id || activity.actor || null,
        );
        if (!account) {
            return null;
        }
        accountId = account.id;
    }

    if (activity.type === 'Follow') {
        eventType = EVENT_TYPE_MAP.Follow;

        if (activity.object !== siteAccount.ap_id) {
            return null;
        }

        const account = await getAccountByApId(
            activity.actor?.id || activity.actor,
        );
        if (!account) {
            return null;
        }
        accountId = account.id;
    }

    return { eventType, accountId, postId, inReplyToPostId };
}

async function main(siteHost, limit = null) {
    if (!siteHost) {
        throw new Error('Site host is required');
    }

    if (limit && Number.isNaN(Number(limit))) {
        throw new Error('Limit must be a number');
    }

    const { user: siteUser, account: siteAccount } =
        await getSiteData(siteHost);

    const inbox = await getKvInbox(siteHost);

    if (!inbox) {
        throw new Error(`No inbox found for site: ${siteHost}`);
    }

    const processedInbox = [...new Set(inbox)];

    const BATCH_SIZE = 50;
    let skipped = 0;
    let created = 0;

    for (let i = 0; i < processedInbox.length; i += BATCH_SIZE) {
        if (limit && created >= Number(limit)) {
            break;
        }

        const batchActivityIds = processedInbox.slice(i, i + BATCH_SIZE);

        const batchActivities = (
            await Promise.all(
                batchActivityIds.map((activityId) => getKvJSON(activityId)),
            )
        ).filter((activity) => activity !== null);

        const batchResults = await Promise.all(
            batchActivities.map((activity) =>
                processActivity(activity, siteUser, siteAccount),
            ),
        );

        const notifications = [];

        for (const processed of batchResults) {
            if (!processed || !processed.eventType || !processed.accountId) {
                skipped++;
                continue;
            }

            if (limit && created + notifications.length >= Number(limit)) {
                break;
            }

            notifications.push({
                event_type: processed.eventType,
                user_id: siteUser.id,
                account_id: processed.accountId,
                post_id: processed.postId,
                in_reply_to_post_id: processed.inReplyToPostId,
            });
        }

        if (notifications.length > 0) {
            await db('notifications').insert(notifications);
            created += notifications.length;
        }

        if (limit && created >= Number(limit)) {
            break;
        }
    }

    return {
        notifications: created,
        skipped,
    };
}

const siteHost = process.env.SITE_HOST || process.argv[2];
const limit = process.env.LIMIT || process.argv[3];

main(siteHost, limit)
    .then(({ notifications, skipped }) => {
        console.log(`${notifications} notifications created`);
        console.log(`${skipped} activities skipped`);

        db.destroy();
    })
    .catch((error) => {
        console.error(error);

        process.exit(1);
    });
