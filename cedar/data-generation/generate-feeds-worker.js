const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');

const { DATA_DIR } = require('./config.js');

const CHUNK_SIZE = 1000; // Write to disk in chunks of 1000 lines

function parseCSV(data) {
    const lines = data.trim().split('\n');
    const headers = lines[0].split(',');

    return lines.slice(1).map((line) => {
        const values = line.split(',');

        return headers.reduce((object, header, index) => {
            object[header] = values[index];

            return object;
        }, {});
    });
}

async function generateFeeds(followsFiles) {
    const users = [];
    const posts = [];
    const authorPostsMap = new Map();

    const usersData = fs.readFileSync(
        path.join(DATA_DIR, 'users.csv'),
        'utf-8',
    );
    const postsData = fs.readFileSync(
        path.join(DATA_DIR, 'posts.csv'),
        'utf-8',
    );

    for (const user of parseCSV(usersData)) {
        users[user.account_id] = user;
    }

    for (const post of parseCSV(postsData)) {
        posts[post.internal_id] = post;

        if (!authorPostsMap.has(post.author_id)) {
            authorPostsMap.set(post.author_id, []);
        }

        authorPostsMap.get(post.author_id).push(post);
    }

    for (const file of followsFiles) {
        const filePath = path.join(DATA_DIR, file);

        const readStream = fs.createReadStream(filePath);
        const writeStream = fs.createWriteStream(
            filePath.replace('follows', 'feeds'),
        );
        const rl = readline.createInterface({
            input: readStream,
            crlfDelay: Number.POSITIVE_INFINITY,
        });

        writeStream.write('user_id,post_id,author_id,post_type\n');

        let batch = [];
        let isFirstLine = true;

        for await (const line of rl) {
            if (isFirstLine) {
                isFirstLine = false;

                continue;
            }

            const [followerId, followingId] = line.split(',');
            const user = users[followingId];

            // Not all accounts are associated with a user
            if (!user) {
                continue;
            }

            const followerPosts = authorPostsMap.get(followerId) || [];

            for (const post of followerPosts) {
                batch.push(
                    `${user.internal_id},${post.internal_id},${post.author_id},${post.type}`,
                );

                if (batch.length >= CHUNK_SIZE) {
                    writeStream.write(`${batch.join('\n')}\n`);

                    batch = [];
                }
            }
        }

        if (batch.length > 0) {
            writeStream.write(`${batch.join('\n')}\n`);
        }

        await new Promise((resolve) => writeStream.end(resolve));

        rl.close();

        parentPort.postMessage({ type: 'progress', value: 1 });
    }

    parentPort.postMessage({ type: 'done' });
}

generateFeeds(workerData.followsFiles);
