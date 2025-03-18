import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import {
    BatchSpanProcessor,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import * as Sentry from '@sentry/node';

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

export function spanWrapper<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
) {
    return (...args: TArgs) => {
        const potentialContext = args[0];
        if (
            potentialContext &&
            typeof potentialContext === 'object' &&
            'req' in potentialContext
        ) {
            if (
                potentialContext.req &&
                typeof potentialContext.req === 'object' &&
                'routePath' in potentialContext.req &&
                'method' in potentialContext.req
            ) {
                if (
                    typeof potentialContext.req.routePath === 'string' &&
                    typeof potentialContext.req.method === 'string'
                ) {
                    const currentSpan = Sentry.getActiveSpan();
                    if (currentSpan) {
                        Sentry.updateSpanName(
                            currentSpan,
                            `${potentialContext.req.method} ${potentialContext.req.routePath}`,
                        );
                        currentSpan.setAttributes({
                            'http.route': potentialContext.req.routePath,
                        });
                    }
                }
            }
        }
        return Sentry.startSpan(
            {
                op: 'fn',
                name: fn.name || 'anonymous',
            },
            () => fn(...args),
        );
    };
}
