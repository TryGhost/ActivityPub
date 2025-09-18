# 3. Use Result Pattern for Error Handling

Date: 2025-01-18

## Status

Accepted

## Context

TypeScript's exception-based error handling creates implicit control flow and lacks type safety for error cases. The ActivityPub server requires explicit, type-safe error handling for network failures, validation errors, and business rule violations.

## Decision

Adopt the Result Pattern for explicit error handling in the business logic layer.

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

### Example Usage

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

// Service returns explicit errors
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
const follow = result.value; // TypeScript knows this is safe
```

## Consequences

### Positive

- Explicit error paths in function signatures
- Type-safe error handling enforced by compiler
- No exception overhead for expected failures
- Clear separation of business failures from system errors

### Negative

- More verbose than try-catch
- Requires refactoring existing exception-based code
- Still need exceptions at system boundaries (HTTP, database)

## Implementation Notes

- Repositories convert database exceptions to Results
- Controllers transform Results to HTTP responses
- Define domain-specific error types:

```typescript
type AccountError =
  | { type: 'NOT_FOUND'; id: string }
  | { type: 'VALIDATION_FAILED'; fields: string[] };
```
