import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { knex } from '@/db';
import { createTestDb } from '@/test/db';

const TEST_TABLE = 'test_timestamps';

describe('Timestamp Test', () => {
    let client: Knex;

    beforeAll(async () => {
        client = await createTestDb();
        await client.schema.dropTableIfExists(TEST_TABLE);
        await client.schema.createTable(TEST_TABLE, (table) => {
            table.increments('id');
            table
                .timestamp('created_at', { precision: 6 })
                .defaultTo(client.fn.now(6));
        });

        afterAll(async () => {
            await client.schema.dropTableIfExists(TEST_TABLE);
            await client.destroy();
        });
    });

    it('should insert and return UTC timestamp', async () => {
        const [id] = await client(TEST_TABLE).insert({});
        const row = await client(TEST_TABLE).where({ id }).first();

        const nowUTC = new Date();
        const createdAt = new Date(row.created_at);

        const diffMs = Math.abs(createdAt.getTime() - nowUTC.getTime());

        expect(diffMs).toBeLessThan(1000);
    });
});

describe('Session time zone', () => {
    afterAll(async () => {
        await knex.destroy();
    });

    // mysql2 reads dates as UTC, so MySQL has to send them in UTC too; on a server
    // running in another zone, CURRENT_TIMESTAMP defaults would come back shifted.
    it('runs every connection in UTC, whatever the server zone is', async () => {
        // Holding both transactions open forces the pool to create two connections
        const trxA = await knex.transaction();
        const trxB = await knex.transaction();

        try {
            const sessions = [];

            for (const trx of [trxA, trxB]) {
                const [rows] = await trx.raw(
                    'SELECT CONNECTION_ID() AS connection_id, @@session.time_zone AS session_zone, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds',
                );
                sessions.push(rows[0]);
            }

            expect(sessions[0].connection_id).not.toBe(
                sessions[1].connection_id,
            );

            for (const session of sessions) {
                expect(session).toMatchObject({
                    session_zone: '+00:00',
                    offset_seconds: 0,
                });
            }
        } finally {
            await trxA.commit();
            await trxB.commit();
        }
    });
});
