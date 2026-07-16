export function getTraceContext(traceContext: string | undefined) {
    if (!traceContext) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const parts = traceContext.split('-');

    if (parts.length !== 4) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const [version, traceId, spanId, flags] = parts;

    // Reject malformed/spoofed traceparent so we don't emit junk trace IDs
    // to Cloud Logging. Version 'ff' and all-zero trace/span IDs are invalid
    // per the W3C Trace Context spec.
    const isValidTraceContext =
        /^[0-9a-f]{2}$/.test(version) &&
        version !== 'ff' &&
        /^[0-9a-f]{32}$/.test(traceId) &&
        !/^0+$/.test(traceId) &&
        /^[0-9a-f]{16}$/.test(spanId) &&
        !/^0+$/.test(spanId) &&
        /^[0-9a-f]{2}$/.test(flags);

    if (!isValidTraceContext) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const sampled = (Number.parseInt(flags, 16) & 0x1) === 1;
    return { traceId, spanId, sampled };
}
