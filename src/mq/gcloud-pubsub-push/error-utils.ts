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

function isUpstreamCertificateError(error: Error): boolean {
    return (
        error.message.match(
            /Hostname\/IP does not match certificate's altnames/i,
        ) !== null
    );
}

function analyzeUpstreamCertificateError(error: Error): ErrorAnalysis {
    // Upstream certificate errors are not retryable and not reportable
    return {
        isRetryable: false,
        isReportable: false,
    };
}

function isFedifyDeliveryError(error: Error): boolean {
    return (
        error.message.match(
            /^Failed to send activity .+ to .+ \((\d{3})\s+[\w\s]+\):/,
        ) !== null
    );
}

function analyzeFedifyDeliveryError(error: Error): ErrorAnalysis {
    const fedifyMatch = error.message.match(
        /^Failed to send activity .+ to .+ \((\d{3})\s+[\w\s]+\):/,
    );

    if (!fedifyMatch) {
        return {
            isRetryable: true,
            isReportable: true,
        };
    }

    // Extract status code from the Fedify delivery error
    const statusCode = Number.parseInt(fedifyMatch[1], 10);

    const permanentFailureCodes = [
        400, // Bad Request
        401, // Unauthorized
        403, // Forbidden
        404, // Not Found
        405, // Method Not Allowed
        410, // Gone
        422, // Unprocessable Entity
        501, // Not Implemented
    ];

    const isRetryable = !permanentFailureCodes.includes(statusCode);

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
 * message format:
 * "Hostname/IP does not match certificate's altnames: Host: <host>. is not in the cert's altnames: DNS:<host>"
 *
 * Non-Fedify delivery errors are considered application errors and are
 * retryable and reportable
 *
 * @param error The error to analyze
 */
export function analyzeError(error: Error): ErrorAnalysis {
    if (isUpstreamCertificateError(error)) {
        return analyzeUpstreamCertificateError(error);
    }

    if (isFedifyDeliveryError(error)) {
        return analyzeFedifyDeliveryError(error);
    }

    return {
        isRetryable: true,
        isReportable: true,
    };
}
