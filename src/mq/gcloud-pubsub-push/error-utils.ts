import { FetchError } from '@fedify/fedify';

export interface ErrorAnalysis {
    /**
     * Whether this error should be retried or not
     */
    isRetryable: boolean;
    /**
     * Whether this error should be reported to error tracking or not
     */
    isReportable: boolean;
}

const MAX_CAUSE_DEPTH = 10;

function isDnsResolutionError(error: Error, depth = 0): boolean {
    if (depth > MAX_CAUSE_DEPTH) {
        return false;
    }

    if (
        error.message.match(/getaddrinfo ENOTFOUND/i) !== null ||
        error.message.match(/getaddrinfo EAI_AGAIN/i) !== null
    ) {
        return true;
    }

    if ('cause' in error && error.cause instanceof Error) {
        return isDnsResolutionError(error.cause, depth + 1);
    }

    return false;
}

function analyzeDnsResolutionError(error: Error): ErrorAnalysis {
    // DNS resolution errors are not retryable and not reportable
    return {
        isRetryable: false,
        isReportable: false,
    };
}

function isUpstreamSSLError(error: Error, depth = 0): boolean {
    if (depth > MAX_CAUSE_DEPTH) {
        return false;
    }

    if (
        error.message.match(
            /Hostname\/IP does not match certificate's altnames/i,
        ) !== null
    ) {
        return true;
    }

    if (
        error.message.match(
            /Client network socket disconnected before secure TLS connection was established/i,
        ) !== null
    ) {
        return true;
    }

    if (error.message.match(/certificate has expired/i) !== null) {
        return true;
    }

    if (error.message.match(/self-signed certificate/i) !== null) {
        return true;
    }

    if ('cause' in error && error.cause instanceof Error) {
        return isUpstreamSSLError(error.cause, depth + 1);
    }

    return false;
}

function analyzeUpstreamSSLError(error: Error): ErrorAnalysis {
    // Upstream certificate errors are not retryable and not reportable
    return {
        isRetryable: false,
        isReportable: false,
    };
}

function isNetworkConnectivityError(error: Error, depth = 0): boolean {
    if (depth > MAX_CAUSE_DEPTH) {
        return false;
    }

    if (
        error.message.match(/connect EHOSTUNREACH/i) !== null ||
        error.message.match(/connect ETIMEDOUT/i) !== null ||
        error.message.match(/connect ECONNREFUSED/i) !== null ||
        error.message.match(/connect ECONNRESET/i) !== null ||
        error.message.match(/socket hang up/i) !== null ||
        error.message.match(/Connect Timeout Error/i) !== null
    ) {
        return true;
    }

    if (error instanceof AggregateError) {
        for (const subError of error.errors) {
            if (
                subError instanceof Error &&
                isNetworkConnectivityError(subError, depth + 1)
            ) {
                return true;
            }
        }
    }

    if ('cause' in error && error.cause instanceof Error) {
        return isNetworkConnectivityError(error.cause, depth + 1);
    }

    return false;
}

function analyzeNetworkConnectivityError(error: Error): ErrorAnalysis {
    // Network connectivity errors are retryable but not reportable
    return {
        isRetryable: true,
        isReportable: false,
    };
}

const FEDIFY_DELIVERY_ERROR_REGEX =
    /^Failed to send activity .+ to .+ \((\d{3})\s+.*?\):/;

function isFedifyDeliveryError(error: Error): boolean {
    return error.message.match(FEDIFY_DELIVERY_ERROR_REGEX) !== null;
}

function analyzeFedifyDeliveryError(error: Error): ErrorAnalysis {
    const fedifyMatch = error.message.match(FEDIFY_DELIVERY_ERROR_REGEX);

    if (!fedifyMatch) {
        return {
            isRetryable: true,
            isReportable: true,
        };
    }

    // Extract status code from the Fedify delivery error
    const statusCode = Number.parseInt(fedifyMatch[1], 10);

    const standardStatusCodes = new Set([
        // 1xx Informational
        100, 101, 102, 103, 104,
        // 2xx Success
        200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
        // 3xx Redirection
        300, 301, 302, 303, 304, 305, 306, 307, 308,
        // 4xx Client Error
        400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413,
        414, 415, 416, 417, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
        // 5xx Server Error
        500, 501, 502, 503, 504, 505, 506, 507, 508, 511,
    ]);

    // Non-standard status codes are not retryable and not reportable
    if (!standardStatusCodes.has(statusCode)) {
        return {
            isRetryable: false,
            isReportable: false,
        };
    }

    const permanentFailureStatusCodes = [
        400, // Bad Request
        401, // Unauthorized
        403, // Forbidden
        404, // Not Found
        405, // Method Not Allowed
        410, // Gone
        422, // Unprocessable Entity
        501, // Not Implemented
    ];

    const isRetryable = !permanentFailureStatusCodes.includes(statusCode);

    return {
        isRetryable,
        // Fedify delivery errors are from remote servers, we don't report
        // them to error tracking
        isReportable: false,
    };
}

function isFetchError(error: Error): error is FetchError {
    return error instanceof FetchError;
}

function analyzeFetchError(error: FetchError): ErrorAnalysis {
    // Extract status code from the Fedify delivery error
    const statusCode = Number.parseInt(
        error.message.match(/HTTP (\d{3})/)?.[1] || '500',
        10,
    );

    const standardStatusCodes = new Set([
        // 1xx Informational
        100, 101, 102, 103, 104,
        // 2xx Success
        200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
        // 3xx Redirection
        300, 301, 302, 303, 304, 305, 306, 307, 308,
        // 4xx Client Error
        400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413,
        414, 415, 416, 417, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
        // 5xx Server Error
        500, 501, 502, 503, 504, 505, 506, 507, 508, 511,
    ]);

    // Non-standard status codes are not retryable and not reportable
    if (!standardStatusCodes.has(statusCode)) {
        return {
            isRetryable: false,
            isReportable: false,
        };
    }

    const permanentFailureStatusCodes = [
        400, // Bad Request
        401, // Unauthorized
        403, // Forbidden
        404, // Not Found
        405, // Method Not Allowed
        410, // Gone
        422, // Unprocessable Entity
        501, // Not Implemented
    ];

    const isRetryable = !permanentFailureStatusCodes.includes(statusCode);

    return {
        isRetryable,
        // Fedify delivery errors are from remote servers, we don't report
        // them to error tracking
        isReportable: false,
    };
}

/**
 * Analyze an error to determine its characteristics and handling strategy
 *
 * Generic Fedify delivery errors have the message format:
 * "Failed to send activity <activity-id> to <inbox-url> (<status-code> <status-text>):\n<error body>"
 *
 * SSL/TLS certificate related Fedify delivery errors are of type TypeError with
 * the message format(s):
 * - "Hostname/IP does not match certificate's altnames: Host: <host>. is not in the cert's altnames: DNS:<host>"
 * - "certificate has expired"
 * - "self-signed certificate"
 *
 * DNS resolution errors have the message format:
 * "getaddrinfo <error-code ENOTFOUND|EAI_AGAIN> <domain>"
 *
 * Network connectivity errors have the message format:
 * "connect <error-code EHOSTUNREACH|ETIMEDOUT|ECONNREFUSED|ECONNRESET> <host:port>"
 * May be wrapped in AggregateError when multiple connection attempts fail
 *
 * Non-Fedify delivery errors are considered application errors and are
 * retryable and reportable
 *
 * @param error The error to analyze
 */
export function analyzeError(error: Error): ErrorAnalysis {
    // TODO: Remove this once Fedify is fixed
    if (error instanceof TypeError && error.message === 'unusable') {
        return {
            isRetryable: true,
            isReportable: false,
        };
    }

    if (isDnsResolutionError(error)) {
        return analyzeDnsResolutionError(error);
    }

    if (isUpstreamSSLError(error)) {
        return analyzeUpstreamSSLError(error);
    }

    if (isNetworkConnectivityError(error)) {
        return analyzeNetworkConnectivityError(error);
    }

    if (isFedifyDeliveryError(error)) {
        return analyzeFedifyDeliveryError(error);
    }

    if (isFetchError(error)) {
        return analyzeFetchError(error);
    }

    return {
        isRetryable: true,
        isReportable: true,
    };
}
