import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import {
    BatchSpanProcessor,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import * as Sentry from '@sentry/node';

(async () => {
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
    }
})();

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
