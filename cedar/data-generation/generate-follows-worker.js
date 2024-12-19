const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');

const { DATA_DIR, NUM_ACCOUNTS, SCALING_FACTOR } = require('./config.js');

const MAX_NUM_FOLLOWERS = Math.round(1000 * SCALING_FACTOR);
const SITE_COUNT_FOLLOWER_OVERRIDE = {
    1: Math.round(2_000_000 * SCALING_FACTOR),
};

const BATCH_SIZE = 10_000; // Process accounts in batches of 10,000
const CHUNK_SIZE = 1000; // Write to disk in chunks of 1000 lines

function generateFollowersForAccount(id) {
    const sampleSize =
        SITE_COUNT_FOLLOWER_OVERRIDE[id] ??
        Math.floor(Math.random() * MAX_NUM_FOLLOWERS) + 1;
    const sample = new Set();

    while (sample.size < sampleSize) {
        const randomAccountId = Math.floor(Math.random() * NUM_ACCOUNTS) + 1;

        if (
            randomAccountId !== id && // Ensure that the account ID is not the same as the current account ID
            !sample.has(randomAccountId) // Ensure that the account ID is not already in the sample
        ) {
            sample.add(randomAccountId);
        }
    }

    return Array.from(sample);
}

async function generateFollowsBatch(start, end) {
    const writeStream = fs.createWriteStream(
        path.join(DATA_DIR, `follows_${start}_${end}.csv`),
    );

    writeStream.write('follower_id,following_id\n');

    return new Promise((resolve, reject) => {
        let written = 0;
        const targetCount = end - start;
        let buffer = '';

        async function writeChunk() {
            try {
                while (written < targetCount) {
                    const chunkEnd = Math.min(
                        written + CHUNK_SIZE,
                        targetCount,
                    );

                    // Process multiple accounts before writing
                    for (let i = written; i < chunkEnd; i++) {
                        const id = start + i + 1;
                        const followers = generateFollowersForAccount(id);

                        for (const followerId of followers) {
                            buffer += `${followerId},${id}\n`;
                        }
                    }

                    // Write accumulated buffer
                    if (buffer.length > 0) {
                        const canContinue = writeStream.write(buffer);
                        buffer = '';

                        if (!canContinue) {
                            await new Promise((resolve) =>
                                writeStream.once('drain', resolve),
                            );
                        }
                    }

                    written += chunkEnd - written;
                }

                writeStream.end();
            } catch (error) {
                reject(error);
            }
        }

        writeStream.on('finish', resolve);
        writeStream.on('error', reject);

        writeChunk();
    });
}

async function generateFollows(start, end) {
    for (let i = start; i < end; i += BATCH_SIZE) {
        const batchStart = i;
        const batchEnd = Math.min(i + BATCH_SIZE, end);

        await generateFollowsBatch(batchStart, batchEnd);

        parentPort.postMessage({ type: 'progress', value: BATCH_SIZE });
    }

    parentPort.postMessage({ type: 'done' });
}

generateFollows(workerData.start, workerData.end);
