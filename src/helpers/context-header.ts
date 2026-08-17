import { TraceFlags } from '@opentelemetry/api';
import { parseTraceParent } from '@opentelemetry/core';

export function getTraceContext(traceContext: string | undefined) {
    if (!traceContext) {
        return { traceId: null, spanId: null, sampled: null };
    }

    // Reject malformed/spoofed traceparent so we don't emit junk trace IDs
    // to Cloud Logging. parseTraceParent enforces the W3C Trace Context
    // rules (hex format, reserved version 'ff', all-zero trace/span IDs).
    const spanContext = parseTraceParent(traceContext);

    if (!spanContext) {
        return { traceId: null, spanId: null, sampled: null };
    }

    return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        sampled: (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0,
    };
}
