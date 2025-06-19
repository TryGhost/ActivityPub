import { describe, expect, it } from 'vitest';
import { knex } from './db';

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
