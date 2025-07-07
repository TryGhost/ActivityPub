import { describe, expect, it } from 'vitest';

import { analyzeError } from './error-utils';

describe('analyzeError', () => {
    it('should handle non Fedify delivery errors as application errors', () => {
        const error = new Error('ECONNREFUSED: Connection refused');

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(true);
        expect(result.isReportable).toBe(true);
    });

    it('should handle application errors', () => {
        const error = new Error('Something went wrong in our code');

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(true);
        expect(result.isReportable).toBe(true);
    });

    it('should handle 400 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (400 Bad Request):\nBad request',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 401 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (401 Unauthorized):\nUnauthorized',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 403 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (403 Forbidden):\nForbidden',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 404 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (404 Not Found):\nNot found',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 405 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://www.example.com/.ghost/activitypub/create/abc123 to https://www.other.com/inbox/index (405 Method Not Allowed):\nError: Request Blocked',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 410 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (410 Gone):\nResource gone',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 422 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (422 Unprocessable Entity):\nValidation failed',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 429 as retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (429 Too Many Requests):\nRate limited',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(true);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 500 as retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (500 Internal Server Error):\nServer error',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(true);
        expect(result.isReportable).toBe(false);
    });

    it('should handle 501 as non-retryable', () => {
        const error = new Error(
            'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (501 Not Implemented):\nNot implemented',
        );

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(false);
        expect(result.isReportable).toBe(false);
    });
});
