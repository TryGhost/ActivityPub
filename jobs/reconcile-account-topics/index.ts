#!/usr/bin/env bun

import mysql from 'mysql2/promise';

import { AccountTopicReconciler } from './lib/AccountTopicReconciler';

const POOL_SIZE = 10;

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
        console.log(`Starting reconcile-account-topics...`);

        if (!process.env.SITES_API_ENDPOINT) {
            throw new Error('SITES_API_ENDPOINT is not set');
        }

        if (!process.env.SITES_API_AUTH_TOKEN) {
            throw new Error('SITES_API_AUTH_TOKEN is not set');
        }

        const apiEndpoint = process.env.SITES_API_ENDPOINT || '';
        const apiAuthToken = process.env.SITES_API_AUTH_TOKEN;

        const accountTopicReconciler = new AccountTopicReconciler(
            pool,
            apiEndpoint,
            apiAuthToken,
        );

        await accountTopicReconciler.run();

        console.log(`Completed!`);
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
