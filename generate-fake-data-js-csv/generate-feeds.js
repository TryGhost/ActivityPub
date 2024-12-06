const { Worker } = require('node:worker_threads');
const cliProgress = require('cli-progress');
const fs = require('node:fs');
const os = require('node:os');

const NUM_WORKERS = os.cpus().length / 2; // Use half the number of available CPUs to avoid overloading the system

const progressBar = new cliProgress.SingleBar(
    {
        clearOnComplete: false,
        hideCursor: true,
        format: '{bar} {percentage}%',
    },
    cliProgress.Presets.shades_classic,
);

async function main() {
    const startTime = Date.now();

    const followsFiles = fs
        .readdirSync('./data')
        .filter((file) => file.startsWith('follows_') && file.endsWith('.csv'));

    const workers = [];
    const filesPerWorker = Math.ceil(followsFiles.length / NUM_WORKERS);

    for (let i = 0; i < NUM_WORKERS; i++) {
        const start = i * filesPerWorker;
        const end = Math.min(start + filesPerWorker, followsFiles.length);

        const worker = new Worker('./generate-feeds-worker.js', {
            workerData: {
                followsFiles: followsFiles.slice(start, end),
            },
        });

        workers.push(worker);
    }

    console.log(
        `Generating feeds from ${followsFiles.length} follows csv files across ${NUM_WORKERS} workers\n`,
    );

    progressBar.start(followsFiles.length, 0);

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
                        if (code !== 0)
                            reject(
                                new Error(
                                    `Worker stopped with exit code ${code}`,
                                ),
                            );
                    });
                }),
        ),
    );

    progressBar.stop();

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const minutes = Math.floor(duration / 60);
    const seconds = (duration % 60).toFixed(0);

    console.log(`\n✅ Feeds generation completed in ${minutes}m ${seconds}s`);
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
