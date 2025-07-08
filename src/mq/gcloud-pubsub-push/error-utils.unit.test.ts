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

    describe('DNS resolution errors', () => {
        it('should handle ENOTFOUND errors as non-retryable', () => {
            const error = new Error('getaddrinfo ENOTFOUND example.com');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle EAI_AGAIN errors as non-retryable', () => {
            const error = new Error('getaddrinfo EAI_AGAIN example.com');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle complex DNS error messages', () => {
            const error = new Error(
                'Error: getaddrinfo ENOTFOUND example.com\n  File "node:dns", line 122, col 26',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });
    });

    describe('SSL/TLS certificate related Fedify delivery errors', () => {
        it('should handle hostname/altnames mismatch as non-retryable', () => {
            const error = new Error(
                "Hostname/IP does not match certificate's altnames: Host: www.example.com. is not in the cert's altnames: DNS:fallback.tls.fastly.net",
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle TypeError with certificate error as non-retryable', () => {
            // This simulates how Fedify wraps SSL errors
            const error = new TypeError(
                "fetch failed\nError: Hostname/IP does not match certificate's altnames: Host: example.com is not in the cert's altnames",
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle TypeError without certificate error as retryable', () => {
            const error = new TypeError('Cannot read property of undefined');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(true);
        });
    });

    describe('Generic Fedify delivery errors', () => {
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

        it('should not match errors with status code pattern but wrong prefix', () => {
            const error = new Error(
                'Some other error (404 Not Found): This should not match',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(true);
        });

        it('should not match errors with partial Fedify format', () => {
            const error = new Error(
                'Error occurred (500 Server Error): but not a Fedify error',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(true);
        });

        it('should not match when status code pattern appears mid-message', () => {
            const error = new Error(
                'Connection failed because server returned (403 Forbidden): access denied',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(true);
        });

        it('should match valid Fedify errors with various activity and inbox formats', () => {
            const testCases = [
                'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (404 Not Found):\nNot found',
                'Failed to send activity https://site.com/posts/abc-123 to https://mastodon.social/users/someone/inbox (400 Bad Request):\nBad request',
                'Failed to send activity https://blog.test/activities/update/post-456 to https://instance.example/actor/inbox (503 Service Unavailable):\nService down',
            ];

            for (const message of testCases) {
                const error = new Error(message);
                const result = analyzeError(error);

                expect(result.isReportable).toBe(false);
            }
        });
    });
});
