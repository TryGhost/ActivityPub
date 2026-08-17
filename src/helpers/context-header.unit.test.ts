import { describe, expect, it } from 'vitest';

import { getTraceContext } from '@/helpers/context-header';

describe('getTraceContext', () => {
    const nullTraceContext = {
        traceId: null,
        spanId: null,
        sampled: null,
    };

    it('returns null fields when traceparent is missing', () => {
        expect(getTraceContext(undefined)).toEqual(nullTraceContext);
    });

    it('parses a valid sampled traceparent header', () => {
        expect(
            getTraceContext(
                '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            ),
        ).toEqual({
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
            sampled: true,
        });
    });

    it('parses a valid unsampled traceparent header', () => {
        expect(
            getTraceContext(
                '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00',
            ),
        ).toEqual({
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
            sampled: false,
        });
    });

    it('parses a future-version traceparent header with extra fields', () => {
        expect(
            getTraceContext(
                '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra',
            ),
        ).toEqual({
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
            sampled: true,
        });
    });

    it.each([
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7',
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra',
        'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'zz-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        '00-xyz-00f067aa0ba902b7-01',
        '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
        '00-4bf92f3577b34da6a3ce929d0e0e4736-xyz-01',
        '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-zz',
    ])('returns null fields for invalid traceparent %s', (traceparent) => {
        expect(getTraceContext(traceparent)).toEqual(nullTraceContext);
    });
});
