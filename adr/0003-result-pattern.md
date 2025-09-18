# 3. Use Result Pattern for Error Handling

Date: 2025-01-18

## Status

Accepted

## Context

Error handling in TypeScript applications typically relies on exceptions and try-catch blocks. However, this approach has several drawbacks:

1. **Implicit error paths**: Exceptions create hidden control flow that's not visible in function signatures
2. **Type safety**: TypeScript doesn't enforce handling of specific error types
3. **Performance**: Exception throwing and stack unwinding has performance overhead
4. **Debugging complexity**: Stack traces from deeply nested exceptions can be difficult to trace
5. **Business logic clarity**: Mixing expected business failures with unexpected system errors

In an ActivityPub server handling federation activities, we need robust error handling for:
- Network failures when communicating with remote servers
- Validation errors for incoming activities
- Database operation failures
- Business rule violations (e.g., blocking, permissions)
- External service failures (Ghost API, storage services)

## Decision

We will use the Result Pattern (also known as Either monad) for explicit error handling throughout the business logic layer.

### Implementation

The Result type is defined as a discriminated union:

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

With helper functions for common operations:

```typescript
// Check if result is error
export function isError<T, E>(result: Result<T, E>): result is { ok: false; error: E }

// Get value (throws if error)
export function getValue<T, E>(result: Result<T, E>): T

// Get error (throws if success)
export function getError<T, E>(result: Result<T, E>): E

// Exhaustive pattern matching
export function exhaustiveCheck<T, E>(result: Result<T, E>): void
```

### Usage Example

```typescript
class AccountService {
  async followAccount(
    follower: Account,
    followee: string
  ): Promise<Result<Follow, FollowError>> {
    // Check if already following
    const existingFollow = await this.repo.findFollow(follower.id, followee);
    if (existingFollow) {
      return { ok: false, error: { type: 'ALREADY_FOLLOWING' } };
    }

    // Check if blocked
    if (await this.isBlocked(follower, followee)) {
      return { ok: false, error: { type: 'BLOCKED' } };
    }

    // Create follow
    const follow = await this.repo.createFollow(follower.id, followee);
    return { ok: true, value: follow };
  }
}

// Consumer must handle all error cases explicitly
const result = await accountService.followAccount(account, targetUrl);
if (isError(result)) {
  switch (result.error.type) {
    case 'ALREADY_FOLLOWING':
      return Response.json({ error: 'Already following' }, { status: 409 });
    case 'BLOCKED':
      return Response.json({ error: 'Cannot follow blocked account' }, { status: 403 });
    default:
      exhaustiveCheck(result.error.type);
  }
}
// Success path is guaranteed here
const follow = result.value;
```

## Consequences

### Positive

1. **Explicit error handling**: All possible errors are visible in function signatures
2. **Type safety**: TypeScript ensures all error cases are handled
3. **Better composability**: Results can be chained and transformed functionally
4. **Clear business logic**: Separates expected failures from unexpected errors
5. **Improved testing**: Error cases are explicit and easier to test
6. **No performance penalty**: No exception overhead for expected failures
7. **Self-documenting**: Function signatures clearly indicate what can go wrong

### Negative

1. **Verbosity**: More code required compared to try-catch
2. **Learning curve**: Developers need to understand the pattern
3. **Inconsistent boundaries**: Still need try-catch at system boundaries (HTTP, database)
4. **Refactoring burden**: Converting existing exception-based code requires significant changes

### Neutral

1. **Mixed approach needed**: System errors (network, database) still use exceptions at boundaries
2. **Repository layer adapts**: Repositories convert database exceptions to Results
3. **Controller layer transforms**: Controllers convert Results to HTTP responses

## Implementation

### Error Type Design

Define specific error types per domain:

```typescript
type AccountError =
  | { type: 'NOT_FOUND'; id: string }
  | { type: 'FORBIDDEN'; reason: string }
  | { type: 'VALIDATION_FAILED'; fields: string[] };

type PostError =
  | { type: 'DUPLICATE'; url: string }
  | { type: 'TOO_LONG'; maxLength: number }
  | { type: 'RATE_LIMITED'; retryAfter: number };
```
