import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex';
import {
    BatchSpanProcessor,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import * as Sentry from '@sentry/node';
import type { Integration } from '@sentry/types';

// Wrapper class to add `name` to the OTel integration to keep TS happy
class KnexIntegration extends KnexInstrumentation implements Integration {
    name = 'knex';
}

if (process.env.SENTRY_DSN) {
    const client = Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'unknown',
        release: process.env.K_REVISION,
        tracesSampleRate: 1.0,
    });

    client?.addIntegration(new KnexIntegration());

    if (process.env.K_SERVICE) {
        client?.traceProvider?.addSpanProcessor(
            new BatchSpanProcessor(new TraceExporter({})),
        );
    }

    if (process.env.NODE_ENV === 'testing') {
        client?.traceProvider?.addSpanProcessor(
            new SimpleSpanProcessor(
                new OTLPTraceExporter({
                    url: 'http://jaeger:4318/v1/traces',
                }),
            ),
        );
    }
}
