const { faker } = require('@faker-js/faker');
const cliProgress = require('cli-progress');
const fs = require('node:fs');
const path = require('node:path');
const {
    DATA_DIR,
    SCALING_FACTOR,
    NUM_SITES,
    NUM_USERS,
    NUM_ACCOUNTS,
    NUM_POSTS,
} = require('./config.js');

const CHUNK_SIZE = 1000; // Write to disk in chunks of 1000 lines

const progressBar = new cliProgress.MultiBar(
    {
        clearOnComplete: false,
        hideCursor: true,
        format: '{name} {bar} {value}/{total}',
    },
    cliProgress.Presets.shades_classic,
);

async function generateData({ name, count, generate }) {
    const writeStream = fs.createWriteStream(
        path.join(DATA_DIR, `${name}.csv`),
    );

    const progress = progressBar.create(count, 0, {
        name: name.padStart(8, ' '),
    });

    const headers = Object.keys(generate(0));
    writeStream.write(`${headers.join(',')}\n`);

    return new Promise((resolve, reject) => {
        async function writeChunks(start) {
            try {
                let chunk = '';

                const end = Math.min(start + CHUNK_SIZE, count);

                for (let i = start; i < end; i++) {
                    const data = generate(i);

                    chunk += `${Object.values(data).join(',')}\n`;

                    progress.increment();
                }

                const canContinue = writeStream.write(chunk);

                if (end < count) {
                    if (!canContinue) {
                        await new Promise((resolve) =>
                            writeStream.once('drain', resolve),
                        );
                    }

                    await writeChunks(end);
                } else {
                    writeStream.end();
                }
            } catch (error) {
                reject(error);
            }
        }

        writeStream.on('finish', resolve);
        writeStream.on('error', reject);

        writeChunks(0);
    });
}

async function generateSites() {
    await generateData({
        name: 'sites',
        count: NUM_SITES,
        dbTable: 'sites',
        generate: (i) => {
            const id = i + 1;

            return {
                internal_id: id,
                host: `site-${id}.com`,
                webhook_secret: faker.string.uuid(),
            };
        },
    });
}

async function generateAccounts() {
    await generateData({
        name: 'accounts',
        count: NUM_ACCOUNTS,
        dbTable: 'accounts',
        generate: (i) => {
            const id = i + 1;

            return {
                internal_id: id,
                name: `Name ${id}`,
                username: `user-${id}`,
                description: 'The quick brown fox jumps over the lazy dog',
                icon: `https://icons.com/${id}.jpg`,
            };
        },
    });
}

async function generateUsers() {
    const usedAccountIds = new Set();

    await generateData({
        name: 'users',
        count: NUM_USERS,
        dbTable: 'users',
        generate: (i) => {
            return {
                internal_id: i + 1,
                account_id: (() => {
                    // Ensure that no other user has this account_id
                    let accountId;

                    do {
                        accountId =
                            Math.floor(Math.random() * NUM_ACCOUNTS) + 1;
                    } while (usedAccountIds.has(accountId));

                    usedAccountIds.add(accountId);

                    return accountId;
                })(),
                site_id: Math.floor(Math.random() * NUM_SITES) + 1,
            };
        },
    });
}

async function generatePosts() {
    await generateData({
        name: 'posts',
        count: NUM_POSTS,
        dbTable: 'posts',
        generate: (i) => {
            const id = i + 1;

            return {
                internal_id: id,
                title: `Post ${id}`,
                content: `This is the content for post ${id}.The quick brown fox jumps over the lazy dog`,
                author_id: Math.floor(Math.random() * NUM_ACCOUNTS) + 1,
                type: faker.helpers.arrayElement([1, 2, 3, 4, 5]),
            };
        },
    });
}

async function main() {
    const startTime = Date.now();

    console.log(`\nScaling factor: ${SCALING_FACTOR}\n`);

    console.log(
        `Generating ${NUM_SITES} sites, ${NUM_ACCOUNTS} accounts, ${NUM_USERS} users and ${NUM_POSTS} posts\n`,
    );

    await Promise.all([
        generateSites(),
        generateAccounts(),
        generateUsers(),
        generatePosts(),
    ]);

    progressBar.stop();

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);

    console.log(`\n✅ Data generation completed in ${minutes}m ${seconds}s`);
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
