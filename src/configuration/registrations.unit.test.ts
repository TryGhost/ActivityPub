import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';

const clusterConstructor = vi.fn();
const redisConstructor = vi.fn();

vi.mock('ioredis', () => {
    class Cluster {
        constructor(...args: unknown[]) {
            clusterConstructor(...args);
        }
    }
    class Redis {
        static Cluster = Cluster;
        constructor(...args: unknown[]) {
            redisConstructor(...args);
        }
    }
    return { default: Redis, Cluster };
});

import { createRedisConnection } from './registrations';

describe('createRedisConnection', () => {
    const logging = {
        info: vi.fn(),
        warn: vi.fn(),
    } as unknown as Logger;

    const originalEnv = { ...process.env };

    beforeEach(() => {
        clusterConstructor.mockClear();
        redisConstructor.mockClear();
        process.env.REDIS_HOST = 'redis-host';
        process.env.REDIS_PORT = '6380';
        delete process.env.REDIS_MODE;
        delete process.env.REDIS_TLS_CERT;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('connects in cluster mode by default', () => {
        createRedisConnection(logging);

        expect(clusterConstructor).toHaveBeenCalledTimes(1);
        expect(redisConstructor).not.toHaveBeenCalled();

        const nodes = clusterConstructor.mock.calls[0][0];
        expect(nodes).toEqual([{ host: 'redis-host', port: 6380 }]);
    });

    it('connects in standalone mode when REDIS_MODE is "standalone"', () => {
        process.env.REDIS_MODE = 'standalone';

        createRedisConnection(logging);

        expect(redisConstructor).toHaveBeenCalledTimes(1);
        expect(clusterConstructor).not.toHaveBeenCalled();

        const options = redisConstructor.mock.calls[0][0];
        expect(options.host).toBe('redis-host');
        expect(options.port).toBe(6380);
    });

    it('throws on an unrecognised REDIS_MODE', () => {
        process.env.REDIS_MODE = 'sentinel';

        expect(() => createRedisConnection(logging)).toThrow(
            /Invalid REDIS_MODE/,
        );
    });

    it('defaults to localhost:6379 when host/port are unset', () => {
        process.env.REDIS_MODE = 'standalone';
        delete process.env.REDIS_HOST;
        delete process.env.REDIS_PORT;

        createRedisConnection(logging);

        const options = redisConstructor.mock.calls[0][0];
        expect(options.host).toBe('localhost');
        expect(options.port).toBe(6379);
    });

    it('passes the TLS certificate through when configured', () => {
        process.env.REDIS_MODE = 'standalone';
        process.env.REDIS_TLS_CERT = 'a-cert';

        createRedisConnection(logging);

        const options = redisConstructor.mock.calls[0][0];
        expect(options.tls).toEqual({ ca: 'a-cert' });
    });
});
