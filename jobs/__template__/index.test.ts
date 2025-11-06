import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from 'bun:test';

import mysql from 'mysql2/promise';

import { doSomething } from './index';

describe('__JOB_NAME__', () => {
    let pool: mysql.Pool;

    beforeAll(async () => {
        pool = await mysql.createPool({
            connectionLimit: 10,
            host: 'localhost',
            port: 3308,
            user: 'root',
            password: 'root',
            database: '__JOB_NAME__',
        });

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS test_table (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255)
            )
        `);
    });

    afterAll(async () => {
        await pool.execute('DROP TABLE IF EXISTS test_table');
        await pool.end();
    });

    beforeEach(async () => {
        await pool.execute('DELETE FROM test_table');
    });

    test('doSomething does something', async () => {
        await pool.execute(`INSERT INTO test_table (name) VALUES (?)`, [
            'test',
        ]);

        const result = await doSomething(pool);

        expect(result.length).toBe(1);
    });
});
