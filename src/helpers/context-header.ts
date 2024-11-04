export function getTraceAndSpanId(traceContext: string | undefined) {
    if (!traceContext) {
        return { traceId: null, spanId: null };
    }

    const parts = traceContext.split('-');

    if (parts.length !== 4) {
        return { traceId: null, spanId: null };
    }

    const [_a, traceId, spanId, _b] = parts;
    return { traceId, spanId };
}
