import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import {
    DiagConsoleLogger,
    DiagLogLevel,
    diag,
    trace,
} from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.NODE_ENV === 'production') {
    if (process.env.OTEL_DEBUG_LOGGING) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL);
    } else {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
    }
}

const sdk = new NodeSDK({
    instrumentations: getNodeAutoInstrumentations(),
    serviceName: 'activitypub',
    traceExporter: process.env.K_SERVICE
        ? new TraceExporter()
        : new OTLPTraceExporter({
              url: 'http://jaeger:4318/v1/traces',
          }),
});

try {
    sdk.start();
} catch (error) {
    console.error('Failed to start OpenTelemetry SDK:', error);
}

const tracer = trace.getTracer('activitypub');

export function spanWrapper<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
) {
    return (...args: TArgs) => {
        return tracer.startActiveSpan(fn.name || 'anonymous', (span) => {
            try {
                return fn(...args);
            } catch (error) {
                span.recordException(error as Error);
                throw error;
            } finally {
                span.end();
            }
        });
    };
}
