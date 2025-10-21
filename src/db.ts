import type { Socket } from 'node:net';

import Knex from 'knex';
import type { Connection } from 'mysql2';

type ConnectionMetadata = {
    createdAt: Date;
    acquireCount: number;
    lastAcquiredAt?: Date;
};

interface ConnectionWithInternals extends Connection {
    stream: Socket;
    _protocolError?: {
        code?: string;
        __connectionMetadata?: {
            connectionAge: {
                milliseconds: number;
                seconds: number;
                minutes: number;
                humanReadable: string;
            };
            createdAt: string;
            closedAt: string;
            acquireCount: number;
            lastAcquiredAt?: string;
            poolConfig: {
                min: number;
                max: number;
                idleTimeoutMillis: number;
            };
        };
    };
}

interface KnexQueryInfo {
    sql: string;
    method: string;
    bindings: unknown[];
}

export interface KnexQueryError extends Error {
    __knexQueryInfo: KnexQueryInfo;
    code?: string;
    errno?: number;
    sqlMessage?: string;
}

const poolConfig = {
    min: parseInt(process.env.MYSQL_CONN_POOL_MIN ?? '1', 10),
    max: parseInt(process.env.MYSQL_CONN_POOL_MAX ?? '200', 10),
    acquireTimeoutMillis: parseInt(
        process.env.MYSQL_CONN_POOL_ACQUIRE_TIMEOUT ?? '30000',
        10,
    ),
    createTimeoutMillis: parseInt(
        process.env.MYSQL_CONN_POOL_CREATE_TIMEOUT ?? '30000',
        10,
    ),
    destroyTimeoutMillis: parseInt(
        process.env.MYSQL_CONN_POOL_DESTROY_TIMEOUT ?? '5000',
        10,
    ),
    idleTimeoutMillis: parseInt(
        process.env.MYSQL_CONN_POOL_IDLE_TIMEOUT ?? '30000',
        10,
    ),
    reapIntervalMillis: parseInt(
        process.env.MYSQL_CONN_POOL_REAP_INTERVAL ?? '1000',
        10,
    ),
    createRetryIntervalMillis: parseInt(
        process.env.MYSQL_CONN_POOL_CREATE_RETRY_INTERVAL ?? '200',
        10,
    ),
};

export const knex = Knex({
    client: 'mysql2',
    connection: process.env.MYSQL_SOCKET_PATH
        ? {
              socketPath: process.env.MYSQL_SOCKET_PATH,
              user: process.env.MYSQL_USER,
              password: process.env.MYSQL_PASSWORD,
              database: process.env.MYSQL_DATABASE,
              timezone: '+00:00',
          }
        : {
              host: process.env.MYSQL_HOST,
              port: Number.parseInt(process.env.MYSQL_PORT!, 10),
              user: process.env.MYSQL_USER,
              password: process.env.MYSQL_PASSWORD,
              database: process.env.MYSQL_DATABASE,
              timezone: '+00:00',
          },
    pool: poolConfig,
});

const pool = knex.client.pool;

const connectionMetadata = new WeakMap<
    ConnectionWithInternals,
    ConnectionMetadata
>();

pool.on(
    'createSuccess',
    (_eventId: number, resource: ConnectionWithInternals) => {
        const metadata = {
            createdAt: new Date(),
            acquireCount: 0,
        };
        connectionMetadata.set(resource, metadata);

        resource.stream.on('close', () => {
            const meta = connectionMetadata.get(resource);
            if (
                meta &&
                resource._protocolError &&
                resource._protocolError.code === 'PROTOCOL_CONNECTION_LOST'
            ) {
                const now = new Date();
                const ageMs = now.getTime() - meta.createdAt.getTime();
                const ageSeconds = Math.floor(ageMs / 1000);
                const ageMinutes = Math.floor(ageSeconds / 60);

                resource._protocolError.__connectionMetadata = {
                    connectionAge: {
                        milliseconds: ageMs,
                        seconds: ageSeconds,
                        minutes: ageMinutes,
                        humanReadable:
                            ageMinutes > 0
                                ? `${ageMinutes}m ${ageSeconds % 60}s`
                                : `${ageSeconds}s`,
                    },
                    createdAt: meta.createdAt.toISOString(),
                    closedAt: now.toISOString(),
                    acquireCount: meta.acquireCount,
                    lastAcquiredAt: meta.lastAcquiredAt?.toISOString(),
                    poolConfig: {
                        min: poolConfig.min,
                        max: poolConfig.max,
                        idleTimeoutMillis: poolConfig.idleTimeoutMillis,
                    },
                };
            }
        });
    },
);

pool.on(
    'acquireSuccess',
    (_eventId: number, resource: ConnectionWithInternals) => {
        const metadata = connectionMetadata.get(resource);
        if (metadata) {
            metadata.acquireCount++;
            metadata.lastAcquiredAt = new Date();
        }
    },
);

pool.on(
    'destroySuccess',
    (_eventId: number, resource: ConnectionWithInternals) => {
        connectionMetadata.delete(resource);
    },
);

knex.on(
    'query-error',
    (
        error: Error,
        obj: { sql: string; method: string; bindings: unknown[] },
    ) => {
        if (error && obj) {
            // Add query information as a non-enumerable property
            Object.defineProperty(error, '__knexQueryInfo', {
                value: {
                    sql: obj.sql,
                    method: obj.method,
                    bindings: obj.bindings,
                },
                enumerable: false,
                configurable: true,
            });
        }
    },
);

export function extractQueryInfoFromError(error: Error): KnexQueryInfo | null {
    if ('__knexQueryInfo' in error) {
        const obj = error.__knexQueryInfo as KnexQueryInfo;

        return {
            sql: obj.sql,
            method: obj.method,
            bindings: obj.bindings,
        };
    }

    return null;
}

export async function getRelatedActivities(
    postUrl: string,
): Promise<{ id: string }[]> {
    return knex
        .select(knex.raw('JSON_EXTRACT(value, "$.id") as id'))
        .from('key_value')
        .where(function () {
            this.where(knex.raw('object_id = ?', [postUrl]))
                .orWhere(knex.raw('object = ?', [postUrl]))
                .orWhere(knex.raw('json_id = ?', [postUrl]));
        }) as unknown as Promise<{ id: string }[]>;
}
