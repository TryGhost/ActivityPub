import { knex } from '@/db';
import { describe, expect, it } from 'vitest';

describe('Knex Configuration', () => {
    it('should use UTC timezone in connection config', () => {
        expect(knex.client.config.connection).toMatchObject({
            timezone: '+00:00',
        });
    });

    it('should have correct pool settings', () => {
        expect(knex.client.pool).toMatchObject({
            min: 1,
            max: 200,
        });
    });
});
