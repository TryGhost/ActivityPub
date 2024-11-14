import { CloudPropagator } from '@google-cloud/opentelemetry-cloud-trace-propagator';
import {
    DiagConsoleLogger,
    DiagLogLevel,
    diag,
    trace,
} from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
    BatchSpanProcessor,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import * as Sentry from '@sentry/node';

const sdk = new NodeSDK({
    instrumentations: getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-mysql2': {
            addSqlCommenterCommentToQueries: true,
        },
    }),
});

const provider = new NodeTracerProvider();
let propagator: CloudPropagator | undefined;

if (process.env.NODE_ENV === 'production') {
    if (process.env.OTEL_DEBUG_LOGGING) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    } else {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
    }
}

if (process.env.K_SERVICE) {
    const { TraceExporter } = await import(
        '@google-cloud/opentelemetry-cloud-trace-exporter'
    );
    provider.addSpanProcessor(new BatchSpanProcessor(new TraceExporter()));

    propagator = new CloudPropagator();
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
    propagator,
});

export const tracer = trace.getTracer('activitypub');

try {
    sdk.start();
} catch (e) {
    console.error(e);
}

if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'unknown',
        release: process.env.K_REVISION,
        skipOpenTelemetrySetup: true,
    });
}

export function spanWrapper<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn | Promise<TReturn>,
) {
    return (...args: TArgs) => {
        return tracer.startActiveSpan(fn.name || 'anonymous', async (span) => {
            try {
                const result = await Promise.resolve(fn(...args));
                span.end();
                return result;
            } catch (error) {
                span.recordException(error as Error);
                span.setStatus({ code: 2 }); // OpenTelemetry ERROR status
                span.end();
                throw error;
            }
        });
    };
}
