export function getTraceAndSpanId(traceContext: string | undefined) {
    // Get the `X-Cloud-Trace-Context` header from the incoming headers
    if (!traceContext) {
        return { traceId: null, spanId: null };
    }

    // Split by "/" to separate TRACE_ID and SPAN_ID
    const [traceId, spanIdPart] = traceContext.split('/');

    if (traceId && spanIdPart) {
        const spanId = spanIdPart.split(';')[0];
        return { traceId, spanId };
    }

    return { traceId: null, spanId: null };
};
