export function getTraceContext(traceContext: string | undefined) {
    if (!traceContext) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const parts = traceContext.split('-');

    if (parts.length !== 4) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const [_version, traceId, spanId, flags] = parts;
    const sampled = (Number.parseInt(flags, 16) & 0x1) === 1;
    return { traceId, spanId, sampled };
}
