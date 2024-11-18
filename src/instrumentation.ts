import {
    DiagConsoleLogger,
    DiagLogLevel,
    type TextMapPropagator,
    diag,
} from '@opentelemetry/api';
import {
    CompositePropagator,
    W3CTraceContextPropagator,
} from '@opentelemetry/core';
import {
    BatchSpanProcessor,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import * as Sentry from '@sentry/node';
import {
    SentryPropagator,
    SentrySampler,
    SentrySpanProcessor,
} from '@sentry/opentelemetry';

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

        skipOpenTelemetrySetup: true,
        tracesSampleRate: 1.0,
    });

    const provider = new NodeTracerProvider({
        sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
    });

    provider.addSpanProcessor(new SentrySpanProcessor());

    const propagators: TextMapPropagator[] = [new SentryPropagator()];

    if (process.env.K_SERVICE) {
        const { TraceExporter } = await import(
            '@google-cloud/opentelemetry-cloud-trace-exporter'
        );
        provider.addSpanProcessor(
            new BatchSpanProcessor(new TraceExporter({})),
        );

        const { CloudPropagator } = await import(
            '@google-cloud/opentelemetry-cloud-trace-propagator'
        );
        propagators.push(new CloudPropagator());
        propagators.push(new W3CTraceContextPropagator());
    }

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

    provider.register({
        propagator: new CompositePropagator({ propagators }),
        contextManager: new Sentry.SentryContextManager(),
    });

    Sentry.validateOpenTelemetrySetup();
}

export function spanWrapper<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
) {
    return (...args: TArgs) => {
        return Sentry.startSpan(
            {
                op: 'fn',
                name: fn.name,
            },
            () => fn(...args),
        );
    };
}
