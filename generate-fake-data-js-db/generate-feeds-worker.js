const { parentPort, workerData } = require('node:worker_threads');
const mysql = require('mysql2/promise');

const { DB_CONFIG } = require('./config.js');

const BATCH_SIZE = 1000;

async function generateFeeds(start, end) {
    const db = await mysql.createPool(DB_CONFIG);

    let data = [];

    for (let i = start; i < end; i++) {
        const id = i + 1;

        const accountId = (
            await db.query(
                `SELECT account_id FROM users WHERE internal_id = ${id}`,
            )
        )[0][0].account_id;

        const followers = (
            await db.query(
                `SELECT follower_id FROM follows WHERE following_id = ${accountId}`,
            )
        )[0].map((follower) => follower.follower_id);

        if (followers.length === 0) {
            parentPort.postMessage({ type: 'progress', value: 1 });

            continue;
        }

        const followerPosts = (
            await db.query(
                `SELECT internal_id, type, author_id FROM posts WHERE author_id IN (${followers.join(',')})`,
            )
        )[0];

        for (const post of followerPosts) {
            data.push({
                user_id: id,
                post_id: post.internal_id,
                author_id: post.author_id,
                type: post.type,
            });
        }

        if (i % BATCH_SIZE === 0 || i === end - 1) {
            await db.query(`
                SET FOREIGN_KEY_CHECKS = 0;
                INSERT INTO feeds (user_id, post_id, author_id, type) VALUES ${data
                    .map(
                        ({ user_id, post_id, author_id, type }) =>
                            `(${user_id}, ${post_id}, ${author_id}, ${type})`,
                    )
                    .join(', ')};
            `);

            data = [];
        }

        parentPort.postMessage({ type: 'progress', value: 1 });
    }

    parentPort.postMessage({ type: 'done' });

    await db.end();
}

generateFeeds(workerData.start, workerData.end);
