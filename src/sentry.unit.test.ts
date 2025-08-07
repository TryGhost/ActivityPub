import { describe, expect, it } from 'vitest';

import type { ErrorEvent, EventHint } from '@sentry/node';

import type { KnexQueryError } from '@/db';
import { beforeSend } from './sentry';

describe('sentry', () => {
    describe('beforeSend', () => {
        it('should return the event unchanged if hint.originalException is not an error', () => {
            const event = {} as ErrorEvent;
            const hint = {
                originalException: 'not an error',
            } as EventHint;

            expect(beforeSend(event, hint)).toEqual(event);
        });

        it('should return the event unchanged if the error is not a Knex query error', () => {
            const event = {} as ErrorEvent;
            const hint = {
                originalException: new Error('not a Knex query error'),
            } as EventHint;

            expect(beforeSend(event, hint)).toEqual(event);
        });

        it('should include knex query info in the event', () => {
            const error = new Error('Knex query error') as KnexQueryError;
            error.__knexQueryInfo = {
                method: 'insert',
                sql: 'INSERT INTO users (name) VALUES (?)',
                bindings: ['John Doe'],
            };

            const event = {} as ErrorEvent;
            const hint = {
                originalException: error,
            } as EventHint;

            expect(beforeSend(event, hint)).toMatchObject({
                contexts: {
                    sql: {
                        operation: 'insert',
                        query: 'INSERT INTO users (name) VALUES (?)',
                        bindings: ['John Doe'],
                    },
                },
            });
        });

        it('should include mysql query info in the event', () => {
            const error = new Error('Knex query error') as KnexQueryError;
            error.code = 'ER_LOCK_DEADLOCK';
            error.errno = 1213;
            error.sqlMessage =
                'Deadlock found when trying to get lock; try restarting transaction';
            error.__knexQueryInfo = {
                method: 'insert',
                sql: 'INSERT INTO users (name) VALUES (?)',
                bindings: ['John Doe'],
            };

            const event = {} as ErrorEvent;
            const hint = {
                originalException: error,
            } as EventHint;

            expect(beforeSend(event, hint)).toMatchObject({
                contexts: {
                    sql: {
                        errno: 1213,
                        sqlMessage:
                            'Deadlock found when trying to get lock; try restarting transaction',
                    },
                },
            });
        });

        it('should set the fingerprint to group errors by error code + query', () => {
            const error = new Error('Knex query error') as KnexQueryError;
            error.code = 'ER_LOCK_DEADLOCK';
            error.errno = 1213;
            error.sqlMessage =
                'Deadlock found when trying to get lock; try restarting transaction';
            error.__knexQueryInfo = {
                method: 'insert',
                sql: 'INSERT INTO users (name) VALUES (?)',
                bindings: ['John Doe'],
            };

            const event = {} as ErrorEvent;
            const hint = {
                originalException: error,
            } as EventHint;

            expect(beforeSend(event, hint)).toMatchObject({
                fingerprint: [
                    'sql-error',
                    'ER_LOCK_DEADLOCK',
                    'INSERT INTO users (name) VALUES (?)',
                ],
            });
        });

        it('should set the title to the error code and query', () => {
            const error = new Error('Knex query error') as KnexQueryError;
            error.code = 'ER_LOCK_DEADLOCK';
            error.errno = 1213;
            error.sqlMessage =
                'Deadlock found when trying to get lock; try restarting transaction';
            error.__knexQueryInfo = {
                method: 'insert',
                sql: 'INSERT INTO users (name) VALUES (?)',
                bindings: ['John Doe'],
            };

            const event = {
                exception: {
                    values: [
                        {
                            value: 'Deadlock found when trying to get lock; try restarting transaction',
                        },
                    ],
                },
            } as ErrorEvent;
            const hint = {
                originalException: error,
            } as EventHint;

            expect(beforeSend(event, hint)).toMatchObject({
                exception: {
                    values: [
                        {
                            value: 'ER_LOCK_DEADLOCK - INSERT INTO users (name) VALUES (?)',
                        },
                    ],
                },
            });
        });

        it('should normalize an insert query with multiple values', () => {
            const error = new Error('Knex query error') as KnexQueryError;
            error.code = 'ER_LOCK_DEADLOCK';
            error.errno = 1213;
            error.sqlMessage =
                'Deadlock found when trying to get lock; try restarting transaction';
            error.__knexQueryInfo = {
                method: 'insert',
                sql: 'INSERT INTO users (name, age) VALUES (?, ?), (?, ?), (?, ?)',
                bindings: ['John Doe', 30, 'Jane Doe', 25, 'Jim Doe', 35],
            };

            const event = {
                exception: {
                    values: [
                        {
                            value: 'Deadlock found when trying to get lock; try restarting transaction',
                        },
                    ],
                },
            } as ErrorEvent;
            const hint = {
                originalException: error,
            } as EventHint;

            expect(beforeSend(event, hint)).toMatchObject({
                fingerprint: [
                    'sql-error',
                    'ER_LOCK_DEADLOCK',
                    'INSERT INTO users (name, age) VALUES (?, ?)',
                ],
                exception: {
                    values: [
                        {
                            value: 'ER_LOCK_DEADLOCK - INSERT INTO users (name, age) VALUES (?, ?)',
                        },
                    ],
                },
            });
        });
    });
});
