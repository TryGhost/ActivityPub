import { describe, expect, it } from 'vitest';
import { client } from './db';

describe('Knex Configuration', () => {
    it('should use UTC timezone in connection config', () => {
        expect(client.client.config.connection).toMatchObject({
            timezone: '+00:00',
        });
    });

    it('should have correct pool settings', () => {
        expect(client.client.pool).toMatchObject({
            min: 1,
            max: 200,
        });
    });
});
