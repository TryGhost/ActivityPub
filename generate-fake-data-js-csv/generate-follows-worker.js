const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');

const { NUM_ACCOUNTS } = require('./config.js');

const MAX_NUM_FOLLOWERS = 1000;
const BATCH_SIZE = 10_000; // Process accounts in batches of 10,000

function generateFollowersForAccount(id) {
    const sampleSize = Math.floor(Math.random() * MAX_NUM_FOLLOWERS) + 1;
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
        `./data/follows_${start}_${end}.csv`,
    );

    writeStream.write('follower_id,following_id\n');

    return new Promise((resolve, reject) => {
        let written = 0;
        const targetCount = end - start;

        function writeChunk() {
            let canContinue = true;

            while (canContinue && written < targetCount) {
                const id = start + written + 1;

                const followers = generateFollowersForAccount(id);

                for (const followerId of followers) {
                    const line = `${followerId},${id}\n`;

                    canContinue = writeStream.write(line);

                    if (!canContinue) {
                        break;
                    }
                }

                if (canContinue) {
                    written++;
                }
            }

            if (written < targetCount) {
                writeStream.once('drain', writeChunk);
            } else {
                writeStream.end();
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
