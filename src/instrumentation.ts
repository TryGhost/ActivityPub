import { IncomingMessage } from 'node:http';
import {
    DiagConsoleLogger,
    DiagLogLevel,
    diag,
    trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { Resource } from '@opentelemetry/resources';
import {
    BatchSpanProcessor,
    NodeTracerProvider,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import * as Sentry from '@sentry/node';

export async function setupInstrumentation() {
    if (process.env.NODE_ENV === 'production') {
        if (process.env.OTEL_DEBUG_LOGGING) {
            diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
        } else {
            diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
        }
    }

    // Setup OpenTelemetry
    const resource = new Resource({
        'service.name': 'activitypub',
        'service.version': process.env.K_REVISION || '1.0.0',
        'deployment.environment': process.env.NODE_ENV || 'unknown',
    });

    const provider = new NodeTracerProvider({
        resource,
    });

    // Configure W3C Trace Context propagator for trace continuation
    provider.register({
        propagator: new W3CTraceContextPropagator(),
    });

    if (process.env.SENTRY_DSN) {
        const sentryClient = Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'unknown',
            release: process.env.K_REVISION,
            tracesSampleRate: 1.0,
            maxValueLength: 2000,
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
                                    } catch (e) {
                                        // Ignore URL parsing errors
                                    }
                                }
                            }
                        },
                        applyCustomAttributesOnSpan: (span) => {},
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

    // Add Google Cloud Trace exporter to OpenTelemetry
    if (process.env.K_SERVICE) {
        const { TraceExporter } = await import(
            '@google-cloud/opentelemetry-cloud-trace-exporter'
        );
        provider.addSpanProcessor(
            new BatchSpanProcessor(new TraceExporter({})),
        );
    }

    // Add OTLP exporter for development
    if (process.env.NODE_ENV === 'development') {
        const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-proto'
        );
        provider.addSpanProcessor(
            new SimpleSpanProcessor(
                new OTLPTraceExporter({
                    url: 'http://jaeger:4318/v1/traces',
                }),
            ),
        );
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

export function otelSpanWrapper<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
) {
    const tracer = trace.getTracer('activitypub', '1.0.0');
    return (...args: TArgs) => {
        return tracer.startActiveSpan(fn.name || 'anonymous', (span) => {
            try {
                const result = fn(...args);
                if (result instanceof Promise) {
                    return result.finally(() => span.end());
                }
                span.end();
                return result;
            } catch (error) {
                span.recordException(error as Error);
                span.end();
                throw error;
            }
        });
    };
}
