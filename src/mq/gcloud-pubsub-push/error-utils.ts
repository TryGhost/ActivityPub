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

/**
 * Analyze an error to determine its characteristics and handling strategy
 *
 * Fedify delivery errors have the format:
 * "Failed to send activity <activity-id> to <inbox-url> (<status-code> <status-text>):\n<error body>"
 *
 * Non-Fedify delivery errors are considered application errors and are
 * retryable and reportable
 *
 * @param error The error to analyze
 */
export function analyzeError(error: Error): ErrorAnalysis {
    // Try to match Fedify delivery error format
    const fedifyMatch = error.message.match(
        /^Failed to send activity .+ to .+ \((\d{3})\s+[\w\s]+\):/,
    );

    // If it's not a Fedify delivery error, treat it as an application error
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
