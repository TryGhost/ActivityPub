import { IncomingMessage } from 'node:http';

import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import {
    BatchSpanProcessor,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import * as Sentry from '@sentry/node';

import { extractQueryInfoFromError } from '@/db';

export async function setupInstrumentation() {
    if (process.env.NODE_ENV === 'production') {
        if (process.env.OTEL_DEBUG_LOGGING) {
            diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
        } else {
            diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
        }
    }

    if (process.env.SENTRY_DSN) {
        const sentryClient = Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'unknown',
            release: process.env.K_REVISION,
            tracesSampleRate: 1.0,
            maxValueLength: 2000,
            beforeSend: (event, hint) => {
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

                    // Set fingerprint to group errors by error code + normalized query
                    // i.e ['sql-error', 'ER_NO_SUCH_TABLE', 'SELECT * FROM a WHERE b = "c"']
                    event.fingerprint = [
                        'sql-error',
                        mysqlErrorCode,
                        queryInfo.sql,
                    ];

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
                            event.exception.values[0].value = `${mysqlErrorCode} - ${queryInfo.sql}`;
                        } else {
                            event.exception.values[0].value = `Query error: ${queryInfo.sql}`;
                        }
                    }
                }

                return event;
            },
            integrations: [
                // Customize HTTP integration to use better span names
                Sentry.httpIntegration({
                    instrumentation: {
                        requestHook: (span, req) => {
                            // Only process IncomingMessage (server-side requests)
                            if (span && req instanceof IncomingMessage) {
                                if (req.url && req.method) {
                                    try {
                                        const url = new URL(
                                            req.url,
                                            `http://${req.headers.host || 'localhost'}`,
                                        );
                                        span.updateName(
                                            `${req.method} ${url.pathname}`,
                                        );
                                        span.setAttributes({
                                            'service.name': 'activitypub',
                                            'http.method': req.method,
                                            'http.route': url.pathname,
                                            'http.url': req.url,
                                            'http.target': url.pathname,
                                        });
                                    } catch (_e) {
                                        // Ignore URL parsing errors
                                    }
                                }
                            }
                        },
                        applyCustomAttributesOnSpan: (_span) => {},
                    },
                }),
            ],
        });

        if (process.env.K_SERVICE) {
            const { TraceExporter } = await import(
                '@google-cloud/opentelemetry-cloud-trace-exporter'
            );
            sentryClient?.traceProvider?.addSpanProcessor(
                new BatchSpanProcessor(new TraceExporter({})),
            );
        }

        if (process.env.NODE_ENV === 'development') {
            const { OTLPTraceExporter } = await import(
                '@opentelemetry/exporter-trace-otlp-proto'
            );
            sentryClient?.traceProvider?.addSpanProcessor(
                new SimpleSpanProcessor(
                    new OTLPTraceExporter({
                        url: 'http://jaeger:4318/v1/traces',
                    }),
                ),
            );
        }

        if (process.env.ENABLE_CPU_PROFILER === 'true') {
            const cpuProfiler = await import('@google-cloud/profiler');
            cpuProfiler.start({
                serviceContext: {
                    service: process.env.K_SERVICE || 'activitypub',
                    version: process.env.K_REVISION || 'unknown',
                },
            });
        }
    }
}

export function spanWrapper<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
) {
    return (...args: TArgs) => {
        return Sentry.startSpan(
            {
                op: 'fn',
                name: fn.name || 'anonymous',
            },
            () => fn(...args),
        );
    };
}
