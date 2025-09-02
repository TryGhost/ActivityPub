import Knex from 'knex';

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
              port: Number.parseInt(process.env.MYSQL_PORT!),
              user: process.env.MYSQL_USER,
              password: process.env.MYSQL_PASSWORD,
              database: process.env.MYSQL_DATABASE,
              timezone: '+00:00',
          },
    pool: {
        min: parseInt(process.env.MYSQL_CONN_POOL_MIN ?? '1'),
        max: parseInt(process.env.MYSQL_CONN_POOL_MAX ?? '200'),
    },
});

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
