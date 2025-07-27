import { IncomingMessage } from 'node:http';
import * as otelApi from '@opentelemetry/api';
import * as opentelemetry from '@opentelemetry/sdk-node';
import * as Sentry from '@sentry/node';

import {
    BatchSpanProcessor,
    type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

export async function setupInstrumentation() {
    if (process.env.NODE_ENV === 'production') {
        if (process.env.OTEL_DEBUG_LOGGING) {
            otelApi.diag.setLogger(
                new otelApi.DiagConsoleLogger(),
                otelApi.DiagLogLevel.DEBUG,
            );
        } else {
            otelApi.diag.setLogger(
                new otelApi.DiagConsoleLogger(),
                otelApi.DiagLogLevel.INFO,
            );
        }
    }

    if (process.env.SENTRY_DSN) {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'unknown',
            release: process.env.K_REVISION,
            tracesSampleRate: 1.0,
            maxValueLength: 2000,
            skipOpenTelemetrySetup: true,
            integrations: [
                // Customize HTTP integration to use better span names
                Sentry.httpIntegration({
                    spans: false,
                    instrumentation: {
                        requestHook: (span, req) => {
                            console.log('!!!!!! request hook for Sentry !!!!!');
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

    const { OTLPTraceExporter } = await import(
        '@opentelemetry/exporter-trace-otlp-proto'
    );

    let traceExporter: SpanExporter | undefined;
    if (process.env.NODE_ENV === 'development') {
        console.log('!!!!!! using OTLPTraceExporter !!!!!');
        traceExporter = new OTLPTraceExporter({
            url: 'http://jaeger:4318/v1/traces',
        });
    }

    const spanProcessors = [];
    if (process.env.K_SERVICE) {
        const { TraceExporter } = await import(
            '@google-cloud/opentelemetry-cloud-trace-exporter'
        );
        spanProcessors.push(new BatchSpanProcessor(new TraceExporter({})));
    }

    const sdk = new opentelemetry.NodeSDK({
        traceExporter,
        instrumentations: [],
        spanProcessors: spanProcessors,
    });

    // otelApi.propagation.setGlobalPropagator(new SentryPropagator());

    sdk.start();
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
