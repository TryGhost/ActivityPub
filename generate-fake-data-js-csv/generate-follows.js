const { Worker } = require('node:worker_threads');
const cliProgress = require('cli-progress');
const os = require('node:os');

const { SCALING_FACTOR, NUM_ACCOUNTS } = require('./config.js');

const NUM_WORKERS = os.cpus().length;

const progressBar = new cliProgress.SingleBar(
    {
        clearOnComplete: false,
        hideCursor: true,
        format: '{bar} {value}/{total}',
    },
    cliProgress.Presets.shades_classic,
);

async function main() {
    const startTime = Date.now();

    console.log(`\nScaling factor: ${SCALING_FACTOR}\n`);

    const workers = [];
    const accountsPerWorker = Math.ceil(NUM_ACCOUNTS / NUM_WORKERS);

    for (let i = 0; i < NUM_WORKERS; i++) {
        const start = i * accountsPerWorker;
        const end = Math.min(start + accountsPerWorker, NUM_ACCOUNTS);

        const worker = new Worker('./generate-follows-worker.js', {
            workerData: {
                start,
                end,
            },
        });

        workers.push(worker);
    }

    console.log(
        `Generating follows for ${NUM_ACCOUNTS} accounts across ${NUM_WORKERS} workers\n`,
    );

    progressBar.start(NUM_ACCOUNTS, 0);

    await Promise.all(
        workers.map(
            (worker) =>
                new Promise((resolve, reject) => {
                    worker.on('message', ({ type, value }) => {
                        if (type === 'progress') {
                            progressBar.increment(value);
                        }

                        if (type === 'done') {
                            resolve();
                        }
                    });

                    worker.on('error', reject);

                    worker.on('exit', (code) => {
                        if (code !== 0) {
                            reject(
                                new Error(
                                    `Worker stopped with exit code ${code}`,
                                ),
                            );
                        }
                    });
                }),
        ),
    );

    progressBar.stop();

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const minutes = Math.floor(duration / 60);
    const seconds = (duration % 60).toFixed(0);

    console.log(`\n✅ Follows generation completed in ${minutes}m ${seconds}s`);
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
