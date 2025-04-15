import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Bottleneck from 'bottleneck';
import mysql from 'mysql2/promise';
import percentile from 'percentile';

const SERIES_RUNS = Number.parseInt(process.env.SERIES_RUNS || '5');
const PARALLEL_RUN_DURATION = Number.parseInt(
    process.env.PARALLEL_RUN_DURATION || '10', // seconds
);
const PARALLEL_QUERIES_PER_SECOND = Number.parseInt(
    process.env.QUERIES_PER_SECOND || '10',
);
const PARALLEL_RUNS = PARALLEL_QUERIES_PER_SECOND * PARALLEL_RUN_DURATION;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: process.env.MYSQL_PORT
        ? Number.parseInt(process.env.MYSQL_PORT)
        : 3306,
    namedPlaceholders: true,
    multipleStatements: true,
});

const limiter = new Bottleneck({
    minTime: 1000 / PARALLEL_QUERIES_PER_SECOND,
});

const warmupPool = async () => {
    console.time('Warmup');
    await Promise.all(
        Array(100)
            .fill(0)
            .map(() => pool.query('SELECT 1')),
    );
    console.timeEnd('Warmup');
};

// TODO: Clean up the any type
// biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
const timeQuery = async (query: string, args: any[]) => {
    //: { [key: string]: string }) => {
    const start = performance.now();
    await pool.query(query, args);
    const end = performance.now();
    return end - start;
};

// TODO: Clean up the any type
// biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
const runQuery = async (query: string, args: any[]) => {
    // { [key: string]: string }) => {
    const runTimes: number[] = Array(SERIES_RUNS).fill(
        Number.POSITIVE_INFINITY,
    );

    for (let run = 0; run < SERIES_RUNS; run++) {
        runTimes[run] = await timeQuery(query, args);
    }

    const parallelRuns: Promise<number>[] = Array(PARALLEL_RUNS).fill(
        Promise.resolve(Number.POSITIVE_INFINITY),
    );
    for (let run = 0; run < PARALLEL_RUNS; run++) {
        parallelRuns[run] = limiter.schedule(() => timeQuery(query, args));
    }

    const parallelRunTimes = await Promise.all(parallelRuns);

    return {
        runTimes,
        parallelRunTimes,
    };
};

const loadQueries = async () => {
    const queriesDir = path.join(__dirname, '../queries');
    const files = await fs.readdir(queriesDir);
    const sqlFiles = files.filter((file) => file.endsWith('.sql'));

    const queries: { [key: string]: string } = {};
    for (const file of sqlFiles) {
        const filePath = path.join(queriesDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const key = path.basename(file, '.sql');
        queries[key] = content;
    }
    return queries;
};

const params = new Map(
    Object.entries({
        /*
    'read-feed': {
        user_id: '189856',
    },
    */
        'read-feed': [189856],
    }),
);

const queries = await loadQueries();

const queryResults: Record<
    string,
    { runTimes: number[]; parallelRunTimes: number[] }
> = {};

await warmupPool();

for (const queryName in queries) {
    if (process.env.QUERY && process.env.QUERY !== queryName) {
        continue;
    }
    const query = queries[queryName];
    const results = await runQuery(query, params.get(queryName) || []);
    queryResults[queryName] = results;

    console.log('\n');

    // calculate P50, P90, P99, P100
    const percentiles = [50, 90, 99, 100];
    console.log(
        `${queryName} - S: ${percentiles
            .map((p) => percentile(p, results.runTimes) as number)
            .map((r, index) => `P${percentiles[index]}: ${r.toFixed(2)}ms`)
            .join(', ')}`,
    );
    console.log(
        `${queryName} - P: ${percentiles
            .map((p) => percentile(p, results.parallelRunTimes) as number)
            .map((r, index) => `P${percentiles[index]}: ${r.toFixed(2)}ms`)
            .join(', ')}`,
    );

    console.log('\n');
}

console.log(JSON.stringify(queryResults));

await pool.end();
