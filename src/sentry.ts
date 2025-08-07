import type { ErrorEvent, EventHint } from '@sentry/node';

import { extractQueryInfoFromError } from '@/db';

export function beforeSend(event: ErrorEvent, hint: EventHint) {
    if (hint.originalException instanceof Error) {
        const error = hint.originalException;
        const queryInfo = extractQueryInfoFromError(error);

        // If the error is not a Knex query error, skip
        if (queryInfo === null) {
            return event;
        }

        let mysqlErrorCode = '';

        if ('code' in error) {
            mysqlErrorCode = String(error.code);
        }

        // Normalize SQL for batch operations to avoid duplicate issues
        let normalizedSql = queryInfo.sql;

        if (queryInfo.method === 'insert') {
            // For INSERT with multiple value sets, normalize to single value set
            // i.e.
            //    insert ... values (?, ?, ?), (?, ?, ?), (?, ?, ?)
            // becomes
            //    insert ... values (?, ?, ?)
            normalizedSql = normalizedSql.replace(
                /(\bvalues\s*\([^)]+\))(?:\s*,\s*\([^)]+\))*/gi,
                '$1',
            );
        }

        // Set fingerprint to group errors by error code + normalized query
        // i.e ['sql-error', 'ER_NO_SUCH_TABLE', 'SELECT * FROM a WHERE b = "c"']
        event.fingerprint = ['sql-error', mysqlErrorCode, normalizedSql];

        // Add query context for additional debugging
        event.contexts = event.contexts || {};
        event.contexts.sql = {
            operation: queryInfo.method,
            query: queryInfo.sql,
            bindings: queryInfo.bindings,
        };

        // Add MySQL-specific error info if available
        if ('errno' in error) {
            event.contexts.sql.errno = error.errno;
        }

        if ('sqlMessage' in error) {
            event.contexts.sql.sqlMessage = error.sqlMessage;
        }

        // Set a normalized title for better grouping display
        // i.e. ER_NO_SUCH_TABLE - SELECT * FROM a WHERE b = "c"
        // See https://sentry.zendesk.com/hc/en-us/articles/28812955455515-How-to-change-an-Issue-s-title
        if (event.exception?.values?.[0]) {
            if (mysqlErrorCode !== '') {
                event.exception.values[0].value = `${mysqlErrorCode} - ${normalizedSql}`;
            } else {
                event.exception.values[0].value = `Query error: ${normalizedSql}`;
            }
        }
    }

    return event;
}
