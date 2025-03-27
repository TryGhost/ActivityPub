import type { Knex } from 'knex';
import { createTestDb } from 'test/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
