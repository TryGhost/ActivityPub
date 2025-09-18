/**
 * Result type for explicit error handling without exceptions.
 * @see ADR-0005: Use error objects instead of strings
 *
 * PREFER: Result<T, { type: 'error-name'; context: any }>
 * AVOID: Result<T, 'error-string'>
 */
export type Ok<T> = [null, T];
export type Error<E> = [E, null];
export type Result<T, E> = Ok<T> | Error<E>;

/**
 * A type predicate for the Error type
 * ```ts
 * if (isError(result)) {
 *   // can safely call `getError(result)` here
 * } else {
 *   // can safely call `getValue(result)` here
 * }
 * ```
 */
export function isError<E>(input: Result<unknown, E>): input is Error<E> {
    return input[1] === null;
}

export function getValue<T>(input: Ok<T>): T {
    return input[1];
}

export function getError<E>(input: Error<E>): E {
    return input[0];
}

/**
 * Returns the value of a result, or throws the error if present.
 */
export function unsafeUnwrap<T>(input: Result<T, unknown>): T {
    if (isError(input)) {
        throw getError(input);
    }
    return getValue(input);
}

export function ok<T>(value: T): Ok<T> {
    return [null, value];
}

export function error<E>(error: E): Error<E> {
    return [error, null];
}

export function exhaustiveCheck(error: never): never {
    throw new Error(`Unhandled error case: ${error}`);
}
