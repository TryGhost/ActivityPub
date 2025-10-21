#!/usr/bin/env bun

import mysql from 'mysql2/promise';

const POOL_SIZE = 10;

export async function doSomething(pool: mysql.Pool) {
    return await pool.query('SELECT * FROM test_table');
}

async function main() {
    const pool = mysql.createPool({
        connectionLimit: POOL_SIZE,
        ...(process.env.DB_SOCKET_PATH
            ? {
                  socketPath: process.env.DB_SOCKET_PATH,
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
                  database: process.env.DB_NAME,
              }
            : {
                  host: process.env.DB_HOST,
                  port: Number.parseInt(process.env.DB_PORT || '3306', 10),
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
                  database: process.env.DB_NAME,
              }),
    });

    try {
        console.log(`Starting __JOB_NAME__...`);

        await doSomething(pool);

        console.log(`✓ Completed!`);
    } catch (error) {
        console.error('Error:', error);

        process.exit(1);
    } finally {
        await pool.end();
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('Unhandled error:', error);

        process.exit(1);
    });
}
