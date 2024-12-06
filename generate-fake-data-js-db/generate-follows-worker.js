const { parentPort, workerData } = require('node:worker_threads');
const mysql = require('mysql2/promise');

const { DB_CONFIG, NUM_ACCOUNTS } = require('./config.js');

const MAX_NUM_FOLLOWERS = 30;
const BATCH_SIZE = 1000;

async function generateFollows(start, end) {
    const db = await mysql.createPool(DB_CONFIG);

    let data = [];

    for (let i = start; i < end; i++) {
        const id = i + 1;

        const sampleSize = Math.floor(Math.random() * MAX_NUM_FOLLOWERS) + 1;
        const sample = new Set();

        while (sample.size < sampleSize) {
            const randomAccountId =
                Math.floor(Math.random() * NUM_ACCOUNTS) + 1;

            if (
                randomAccountId !== id && // Ensure that the account ID is not the same as the current account ID
                sample.has(randomAccountId) === false // Ensure that the account ID is not already in the sample
            ) {
                sample.add(randomAccountId);
            }
        }

        const follows = Array.from(sample).map((followerId) => ({
            follower_id: followerId,
            following_id: id,
        }));

        data.push(...follows);

        if (i % BATCH_SIZE === 0 || i === end - 1) {
            await db.query(`
                SET FOREIGN_KEY_CHECKS = 0;
                INSERT INTO follows (follower_id, following_id) VALUES ${data
                    .map(
                        ({ follower_id, following_id }) =>
                            `(${follower_id}, ${following_id})`,
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

generateFollows(workerData.start, workerData.end);
