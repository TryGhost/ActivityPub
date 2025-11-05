import { IncomingMessage } from 'node:http';
import { Session } from 'node:inspector';

import type { Logger } from '@logtape/logtape';
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import * as Sentry from '@sentry/node';

import { beforeSend } from '@/sentry';
import { GCPStorageAdapter } from '@/storage/adapters/gcp-storage-adapter';

export async function setupInstrumentation(logger: Logger) {
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
            beforeSend: beforeSend,
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
    }

    if (process.env.ENABLE_GCP_CPU_PROFILER === 'true') {
        (async () => {
            try {
                const cpuProfiler = await import('@google-cloud/profiler');
                await cpuProfiler.start({
                    serviceContext: {
                        service: process.env.K_SERVICE || 'activitypub',
                        version: process.env.K_REVISION || 'unknown',
                    },
                });
            } catch (error) {
                logger.error(`Failed to start CPU profiler: ${error}`);
            }
        })();
    }

    if (
        process.env.ENABLE_NODE_CPU_PROFILE_FOR &&
        process.env.NODE_CPU_PROFILE_BUCKET_NAME
    ) {
        startNodeCpuProfiling(process.env.ENABLE_NODE_CPU_PROFILE_FOR, logger);
    }
}

function parseDuration(duration: string): number | null {
    const match = duration.match(/^(\d+)(s|m|h)$/);

    if (!match) {
        return null;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 's':
            return value * 1000;
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        default:
            return null;
    }
}

function startNodeCpuProfiling(durationStr: string, logger: Logger): void {
    const durationMs = parseDuration(durationStr);

    if (durationMs === null) {
        logger.error(
            `Invalid CPU_PROFILE_FOR format: ${durationStr}. Expected format: 1m, 5m, 30s, etc.`,
        );
        return;
    }

    logger.info(`CPU profiling enabled for ${durationMs}ms`);

    try {
        const session = new Session();
        session.connect();

        logger.info('Starting CPU profiling');

        session.post('Profiler.enable', (err) => {
            if (err) {
                logger.error('Failed to enable profiler - {error}', {
                    error: err,
                });
                session.disconnect();
                return;
            }

            session.post('Profiler.start', (startErr) => {
                if (startErr) {
                    logger.error('Failed to start profiler - {error}', {
                        error: startErr,
                    });
                    session.disconnect();
                    return;
                }

                setTimeout(() => {
                    stopAndUploadProfile(session, logger);
                }, durationMs);
            });
        });
    } catch (error) {
        logger.error('Failed to initialize CPU profiling - {error}', { error });
    }
}

function stopAndUploadProfile(session: Session, logger: Logger): void {
    session.post('Profiler.stop', (err, result) => {
        if (err) {
            logger.error('Failed to stop profiler - {error}', { error: err });
            session.disconnect();
            return;
        }

        const { profile } = result;

        logger.info('Stopping CPU profiling');
        (async () => {
            try {
                const timestamp = new Date()
                    .toISOString()
                    .replace(/[:.]/g, '-');
                const filename = `cpu-profile-${timestamp}.cpuprofile`;

                const profileData = JSON.stringify(profile);

                const bucketName = process.env.NODE_CPU_PROFILE_BUCKET_NAME;

                const storageAdapter = new GCPStorageAdapter(
                    bucketName || '',
                    logger,
                    process.env.GCP_STORAGE_EMULATOR_HOST || '',
                    process.env.GCS_LOCAL_STORAGE_HOSTING_URL || '',
                );

                const blob = new Blob([profileData], {
                    type: 'application/json',
                });
                const file = new File([blob], filename, {
                    type: 'application/json',
                });

                const result = await storageAdapter.save(file, filename);

                if (result[0]) {
                    logger.error('Failed to upload CPU profile - {error}', {
                        error: result[0],
                    });
                    return;
                }
                logger.info(`CPU profile uploaded to: ${result[1]}`);
            } catch (error) {
                logger.error('Failed to process CPU profile - {error}', {
                    error,
                });
            } finally {
                session.disconnect();
            }
        })();
    });
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
