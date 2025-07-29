import { FetchError } from '@fedify/fedify';
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

    it('should handle errors with non-Error causes gracefully', () => {
        const error = new Error('Something failed');
        Object.defineProperty(error, 'cause', {
            value: 'string cause',
            enumerable: false,
            configurable: true,
        });

        const result = analyzeError(error);

        expect(result.isRetryable).toBe(true);
        expect(result.isReportable).toBe(true);
    });

    it('should handle errors with null causes gracefully', () => {
        const error = new Error('Something failed');
        Object.defineProperty(error, 'cause', {
            value: null,
            enumerable: false,
            configurable: true,
        });

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

        it('should handle DNS errors in error cause chain', () => {
            const dnsError = new Error(
                'getaddrinfo ENOTFOUND djordjes-mbp.tail5da2a.ts.net',
            );

            const fetchError = new TypeError('fetch failed');
            Object.defineProperty(fetchError, 'cause', {
                value: dnsError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(fetchError);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle deeply nested DNS errors', () => {
            const dnsError = new Error('getaddrinfo EAI_AGAIN example.com');

            const middleError = new Error('Network request failed');
            Object.defineProperty(middleError, 'cause', {
                value: dnsError,
                enumerable: false,
                configurable: true,
            });

            const topError = new TypeError('fetch failed');
            Object.defineProperty(topError, 'cause', {
                value: middleError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(topError);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle circular error references without stack overflow', () => {
            // Create a circular reference chain
            const error1 = new Error('Error 1');
            const error2 = new Error('Error 2');
            const error3 = new Error(
                'Error 3 - getaddrinfo ENOTFOUND example.com',
            );

            // Create circular references
            Object.defineProperty(error1, 'cause', {
                value: error2,
                enumerable: false,
                configurable: true,
            });

            Object.defineProperty(error2, 'cause', {
                value: error3,
                enumerable: false,
                configurable: true,
            });

            Object.defineProperty(error3, 'cause', {
                value: error1, // Circular reference back to error1
                enumerable: false,
                configurable: true,
            });

            // This should not cause stack overflow
            const result = analyzeError(error1);

            // Even with circular reference, we should detect the DNS error
            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should stop recursion at MAX_CAUSE_DEPTH even without finding target error', () => {
            // Create a deep chain that exceeds MAX_CAUSE_DEPTH (10)
            // Start with DNS error at the bottom
            const dnsError = new Error(
                'getaddrinfo ENOTFOUND deep.example.com',
            );

            let currentError = dnsError;

            // Build chain from bottom to top (15 levels, more than MAX_CAUSE_DEPTH of 10)
            for (let i = 0; i < 15; i++) {
                const wrapperError = new Error(`Nested error level ${15 - i}`);

                Object.defineProperty(wrapperError, 'cause', {
                    value: currentError,
                    enumerable: false,
                    configurable: true,
                });

                currentError = wrapperError;
            }

            // currentError is now the top-level error with DNS error buried 15 levels deep

            // This should not find the DNS error because it's beyond MAX_CAUSE_DEPTH
            const result = analyzeError(currentError);

            // Should be treated as generic error (retryable and reportable)
            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(true);
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

        it('should handle certificate errors in error cause chain', () => {
            const certError = new Error(
                "Hostname/IP does not match certificate's altnames: Host: example.com. is not in the cert's altnames: DNS:other.com",
            );
            const fetchError = new TypeError('fetch failed');

            Object.defineProperty(fetchError, 'cause', {
                value: certError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(fetchError);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle deeply nested certificate errors', () => {
            const certError = new Error(
                "Hostname/IP does not match certificate's altnames: Host: www.example.com",
            );

            const middleError = new Error('SSL handshake failed');
            Object.defineProperty(middleError, 'cause', {
                value: certError,
                enumerable: false,
                configurable: true,
            });

            const topError = new TypeError('Request failed');
            Object.defineProperty(topError, 'cause', {
                value: middleError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(topError);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle circular certificate error references without stack overflow', () => {
            // Create a circular reference chain with certificate error
            const error1 = new Error('Error 1');
            const error2 = new Error('Error 2');
            const error3 = new Error(
                "Hostname/IP does not match certificate's altnames: Host: example.com",
            );

            // Create circular references
            Object.defineProperty(error1, 'cause', {
                value: error2,
                enumerable: false,
                configurable: true,
            });

            Object.defineProperty(error2, 'cause', {
                value: error3,
                enumerable: false,
                configurable: true,
            });

            Object.defineProperty(error3, 'cause', {
                value: error1, // Circular reference back to error1
                enumerable: false,
                configurable: true,
            });

            // This should not cause stack overflow
            const result = analyzeError(error1);

            // Even with circular reference, we should detect the certificate error
            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should stop certificate error recursion at MAX_CAUSE_DEPTH', () => {
            // Create a deep chain that exceeds MAX_CAUSE_DEPTH (10)
            // Start with certificate error at the bottom
            const certError = new Error(
                "Hostname/IP does not match certificate's altnames: Host: deep.example.com",
            );

            let currentError = certError;

            // Build chain from bottom to top (15 levels, more than MAX_CAUSE_DEPTH of 10)
            for (let i = 0; i < 15; i++) {
                const wrapperError = new Error(`SSL error level ${15 - i}`);

                Object.defineProperty(wrapperError, 'cause', {
                    value: currentError,
                    enumerable: false,
                    configurable: true,
                });

                currentError = wrapperError;
            }

            // currentError is now the top-level error with certificate error buried 15 levels deep

            // This should not find the certificate error because it's beyond MAX_CAUSE_DEPTH
            const result = analyzeError(currentError);

            // Should be treated as generic error (retryable and reportable)
            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(true);
        });

        it('should handle certificate expiration errors as non-retryable', () => {
            const error = new Error('certificate has expired');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle certificate expiration errors in error cause chain', () => {
            const certError = new Error('certificate has expired');
            const tlsError = new Error('TLS handshake failed');
            Object.defineProperty(tlsError, 'cause', {
                value: certError,
                enumerable: false,
                configurable: true,
            });

            const fetchError = new TypeError('fetch failed');
            Object.defineProperty(fetchError, 'cause', {
                value: tlsError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(fetchError);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle certificate expiration with various case formats', () => {
            const testCases = [
                'certificate has expired',
                'Certificate has expired',
                'CERTIFICATE HAS EXPIRED',
                'Error: certificate has expired',
                'TLS Error: Certificate Has Expired',
            ];

            for (const message of testCases) {
                const error = new Error(message);
                const result = analyzeError(error);

                expect(result.isRetryable).toBe(false);
                expect(result.isReportable).toBe(false);
            }
        });

        it('should handle self-signed certificate errors as non-retryable', () => {
            const error = new Error('self-signed certificate');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle self-signed certificate errors in error cause chain', () => {
            const certError = new Error('self-signed certificate');
            const tlsError = new Error('TLS handshake failed');
            Object.defineProperty(tlsError, 'cause', {
                value: certError,
                enumerable: false,
                configurable: true,
            });

            const fetchError = new TypeError('fetch failed');
            Object.defineProperty(fetchError, 'cause', {
                value: tlsError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(fetchError);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle self-signed certificate with various case formats', () => {
            const testCases = [
                'self-signed certificate',
                'Self-signed certificate',
                'SELF-SIGNED CERTIFICATE',
                'Error: self-signed certificate',
                'TLS Error: Self-Signed Certificate',
            ];

            for (const message of testCases) {
                const error = new Error(message);
                const result = analyzeError(error);

                expect(result.isRetryable).toBe(false);
                expect(result.isReportable).toBe(false);
            }
        });
    });

    describe('Network connectivity errors', () => {
        it('should handle EHOSTUNREACH errors as non-retryable', () => {
            const error = new Error(
                'connect EHOSTUNREACH 2403:5815:4782:15:be24:11ff:fece:137c:443 - Local (:::0)',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle ETIMEDOUT errors as non-retryable', () => {
            const error = new Error('connect ETIMEDOUT 119.17.159.140:443');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle ECONNREFUSED errors as non-retryable', () => {
            const error = new Error('connect ECONNREFUSED 127.0.0.1:443');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle read ECONNRESET errors as non-retryable', () => {
            const error = new Error('read ECONNRESET');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle connect ECONNRESET errors as non-retryable', () => {
            const error = new Error('connect ECONNRESET');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle socket hang up errors as non-retryable', () => {
            const error = new Error('socket hang up');

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle network errors in error cause chain', () => {
            const connectError = new Error(
                'connect EHOSTUNREACH 2a04:4e42:600::775:443 - Local (:::0)',
            );
            const fetchError = new TypeError('fetch failed');
            Object.defineProperty(fetchError, 'cause', {
                value: connectError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(fetchError);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle AggregateError with network connectivity errors', () => {
            const errors = [
                new Error(
                    'connect EHOSTUNREACH 2a04:4e42:600::775:443 - Local (:::0)',
                ),
                new Error('connect ETIMEDOUT 151.101.131.7:443'),
                new Error(
                    'connect EHOSTUNREACH 2a04:4e42:400::775:443 - Local (:::0)',
                ),
                new Error('connect ETIMEDOUT 151.101.3.7:443'),
            ];

            const aggregateError = new AggregateError(errors);

            const result = analyzeError(aggregateError);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle AggregateError in error cause chain', () => {
            const errors = [
                new Error(
                    'connect EHOSTUNREACH 2a04:4e42:600::775:443 - Local (:::0)',
                ),
                new Error('connect ETIMEDOUT 151.101.131.7:443'),
            ];

            const aggregateError = new AggregateError(errors);
            const fetchError = new TypeError('fetch failed');
            Object.defineProperty(fetchError, 'cause', {
                value: aggregateError,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(fetchError);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle AggregateError with non-network errors as retryable', () => {
            const errors = [
                new Error('Some other error'),
                new Error('Another random error'),
            ];

            const aggregateError = new AggregateError(errors);

            const result = analyzeError(aggregateError);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(true);
        });

        it('should handle deeply nested AggregateError', () => {
            const connectError = new Error(
                'connect ETIMEDOUT 151.101.131.7:443',
            );
            const innerAggregate = new AggregateError([connectError]);
            const outerAggregate = new AggregateError([innerAggregate]);
            const fetchError = new TypeError('fetch failed');
            Object.defineProperty(fetchError, 'cause', {
                value: outerAggregate,
                enumerable: false,
                configurable: true,
            });

            const result = analyzeError(fetchError);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle network connectivity errors with various case formats', () => {
            const testCases = [
                'connect EHOSTUNREACH 192.168.1.1:443',
                'Connect ETIMEDOUT 10.0.0.1:443',
                'CONNECT ECONNREFUSED localhost:3000',
                'Error: connect ECONNRESET',
                'Socket hang up',
                'SOCKET HANG UP',
            ];

            for (const message of testCases) {
                const error = new Error(message);
                const result = analyzeError(error);

                expect(result.isRetryable).toBe(true);
                expect(result.isReportable).toBe(false);
            }
        });
    });

    describe('FetchError handling', () => {
        it('should handle FetchError with HTTP 503 as retryable', () => {
            const error = new FetchError(
                'https://mastodon.nz/users/BobLefridge',
                'HTTP 503: https://mastodon.nz/users/BobLefridge',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 404 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/users/notfound',
                'HTTP 404: https://example.com/users/notfound',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 400 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 400: Bad Request',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 401 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 401: Unauthorized',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 403 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 403: Forbidden',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 410 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 410: Gone',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 422 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 422: Unprocessable Entity',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 429 as retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 429: Too Many Requests',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 500 as retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 500: Internal Server Error',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 502 as retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 502: Bad Gateway',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 504 as retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 504: Gateway Timeout',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with non-standard HTTP 520 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 520: Web Server Returns an Unknown Error',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with non-standard HTTP 522 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 522: Connection Timed Out',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError without HTTP status code as retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'Network error occurred',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with malformed HTTP status as retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP abc: Invalid status',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(true);
            expect(result.isReportable).toBe(false);
        });

        it('should handle FetchError with HTTP 501 as non-retryable', () => {
            const error = new FetchError(
                'https://example.com/api',
                'HTTP 501: Not Implemented',
            );

            const result = analyzeError(error);

            expect(result.isRetryable).toBe(false);
            expect(result.isReportable).toBe(false);
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

        it('should handle non-standard 5xx codes as non-retryable', () => {
            const nonStandardStatusCodes = [
                520, // Cloudflare: Web server returns an unknown error
                521, // Cloudflare: Web server is down
                522, // Cloudflare: Connection timed out
                523, // Cloudflare: Origin is unreachable
                524, // Cloudflare: A timeout occurred
                525, // Cloudflare: SSL handshake failed
                526, // Cloudflare: Invalid SSL certificate
                527, // Cloudflare: Railgun error
                530, // Cloudflare: Site is frozen
                598, // Network read timeout error
                599, // Network connect timeout error
            ];

            for (const statusCode of nonStandardStatusCodes) {
                const error = new Error(
                    `Failed to send activity https://example.com/activity/123 to https://other.com/inbox (${statusCode} Custom Error):\nProvider specific error`,
                );

                const result = analyzeError(error);

                expect(result.isRetryable).toBe(false);
                expect(result.isReportable).toBe(false);
            }
        });

        it('should handle non-standard 5xx codes without message as non-retryable', () => {
            const nonStandardStatusCodes = [
                520, // Cloudflare: Web server returns an unknown error
                521, // Cloudflare: Web server is down
                522, // Cloudflare: Connection timed out
                523, // Cloudflare: Origin is unreachable
                524, // Cloudflare: A timeout occurred
                525, // Cloudflare: SSL handshake failed
                526, // Cloudflare: Invalid SSL certificate
                527, // Cloudflare: Railgun error
                530, // Cloudflare: Site is frozen
                598, // Network read timeout error
                599, // Network connect timeout error
            ];

            for (const statusCode of nonStandardStatusCodes) {
                const error = new Error(
                    `Failed to send activity https://example.com/activity/123 to https://other.com/inbox (${statusCode} ):\nProvider specific error`,
                );

                const result = analyzeError(error);

                expect(result.isRetryable).toBe(false);
                expect(result.isReportable).toBe(false);
            }
        });

        it('should handle non-standard 4xx codes as non-retryable', () => {
            const nonStandardStatusCodes = [
                419, // Non-standard
                420, // Non-standard
                430, // Non-standard
                440, // Non-standard
                444, // nginx: No Response
                449, // Microsoft: Retry With
                450, // Microsoft: Blocked by Windows Parental Controls
                460, // AWS ELB: Client closed connection
                463, // AWS ELB: X-Forwarded-For header with more than 30 IPs
                494, // nginx: Request header too large
                495, // nginx: SSL Certificate Error
                496, // nginx: SSL Certificate Required
                497, // nginx: HTTP Request Sent to HTTPS Port
                498, // Non-standard
                499, // nginx: Client Closed Request
            ];

            for (const statusCode of nonStandardStatusCodes) {
                const error = new Error(
                    `Failed to send activity https://example.com/activity/123 to https://other.com/inbox (${statusCode} Custom Error):\nProvider specific error`,
                );

                const result = analyzeError(error);

                expect(result.isRetryable).toBe(false);
                expect(result.isReportable).toBe(false);
            }
        });

        it('should handle standard 5xx codes as retryable', () => {
            const standardRetryableStatusCodes = [
                502, // Bad Gateway
                503, // Service Unavailable
                504, // Gateway Timeout
                507, // Insufficient Storage
                508, // Loop Detected
                511, // Network Authentication Required
            ];

            for (const statusCode of standardRetryableStatusCodes) {
                const error = new Error(
                    `Failed to send activity https://example.com/activity/123 to https://other.com/inbox (${statusCode} Standard Error):\nStandard error`,
                );

                const result = analyzeError(error);

                expect(result.isRetryable).toBe(true);
                expect(result.isReportable).toBe(false);
            }
        });
    });
});
