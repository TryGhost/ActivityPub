import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

let siteCount = 0;
let accountCount = 0;
let postCount = 0;

export async function dbCreateSite(db: Knex) {
    siteCount++;

    const data = {
        host: `site-${siteCount}.com`,
        webhook_secret: 'test',
    };

    const [siteId] = await db('sites').insert(data);

    return {
        id: siteId,
        ...data,
    };
}

export async function dbCreateAccount(db: Knex, site: { host: string }) {
    accountCount++;

    const username = `account-${accountCount}`;
    const uuid = randomUUID();
    const data = {
        username,
        name: `Account ${accountCount}`,
        bio: `Bio for account ${accountCount}`,
        avatar_url: `https://${site.host}/${uuid}/avatar.png`,
        banner_image_url: `https://${site.host}/${uuid}/banner.png`,
        url: `https://${site.host}/${username}`,
        ap_id: `https://${site.host}/${uuid}`,
        ap_inbox_url: `https://${site.host}/${uuid}/inbox`,
        ap_shared_inbox_url: `https://${site.host}/inbox`,
        ap_outbox_url: `https://${site.host}/${uuid}/outbox`,
        ap_following_url: `https://${site.host}/${uuid}/following`,
        ap_followers_url: `https://${site.host}/${uuid}/followers`,
        ap_liked_url: `https://${site.host}/${uuid}/liked`,
        uuid,
    };

    const [accountId] = await db('accounts').insert(data);

    return {
        id: accountId,
        ...data,
    };
}

export async function dbCreateUser(
    db: Knex,
    account: { id: number },
    site: { id: number },
) {
    const data = {
        account_id: account.id,
        site_id: site.id,
    };

    const [userId] = await db('users').insert(data);

    return {
        id: userId,
        ...data,
    };
}

export async function dbCreatePost(
    db: Knex,
    account: { id: number },
    site: { host: string },
) {
    postCount++;

    const uuid = randomUUID();
    const data = {
        uuid,
        type: 1,
        audience: 0,
        author_id: account.id,
        title: `Post ${postCount}`,
        excerpt: `Excerpt for post ${postCount}`,
        content: `<p>Content for post ${postCount}</p>`,
        url: `https://${site.host}/post/post-${postCount}`,
        ap_id: `https://${site.host}/post/${uuid}`,
    };

    const [postId] = await db('posts').insert(data);

    return {
        id: postId,
        ...data,
    };
}

export async function dbCreateFollow(
    db: Knex,
    follower: { id: number },
    following: { id: number },
) {
    const data = {
        follower_id: follower.id,
        following_id: following.id,
    };

    await db('follows').insert(data);
}

export async function dbCreateLike(
    db: Knex,
    account: { id: number },
    post: { id: number },
) {
    const data = {
        account_id: account.id,
        post_id: post.id,
    };

    await db('likes').insert(data);
}

export async function dbCreateRepost(
    db: Knex,
    account: { id: number },
    post: { id: number },
) {
    const data = {
        account_id: account.id,
        post_id: post.id,
    };

    await db('reposts').insert(data);
}
