export function getTraceContext(traceContext: string | undefined) {
    if (!traceContext) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const parts = traceContext.split('-');

    if (parts.length !== 4) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const [version, traceId, spanId, flags] = parts;

    const isValidTraceContext =
        /^[0-9a-f]{2}$/.test(version) &&
        /^[0-9a-f]{32}$/.test(traceId) &&
        traceId !== '00000000000000000000000000000000' &&
        /^[0-9a-f]{16}$/.test(spanId) &&
        spanId !== '0000000000000000' &&
        /^[0-9a-f]{2}$/.test(flags);

    if (!isValidTraceContext) {
        return { traceId: null, spanId: null, sampled: null };
    }

    const sampled = (Number.parseInt(flags, 16) & 0x1) === 1;
    return { traceId, spanId, sampled };
}
