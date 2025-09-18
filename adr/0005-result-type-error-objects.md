# Enhance Result Types with Error Objects

## Status

Accepted

## Context

While our Result type pattern (ADR-0004) provides explicit error handling, using plain strings for errors has limitations:
- Cannot attach additional context (e.g., which ID wasn't found)
- Cannot differentiate error types programmatically
- Makes exhaustive error handling impossible
- Lacks structured information for debugging and logging

## Decision

Enhance the Result type pattern by using discriminated union error objects instead of strings.

## Implementation

```typescript
// Define error objects with context
type AccountError =
  | { type: 'not-found'; accountId: string }
  | { type: 'suspended'; until: Date }
  | { type: 'network-error'; retryable: boolean }

// Return error objects instead of strings
async function getAccount(id: string): Promise<Result<Account, AccountError>> {
  if (!found) {
    return error({ type: 'not-found', accountId: id });
  }
  // ...
}

// Handle errors exhaustively with type safety
const result = await getAccount('123');
if (isError(result)) {
  const err = getError(result);
  switch (err.type) {
    case 'not-found':
      log(`Account ${err.accountId} not found`);
      break;
    case 'suspended':
      log(`Suspended until ${err.until}`);
      break;
    case 'network-error':
      if (err.retryable) retry();
      break;
    default:
      exhaustiveCheck(err);  // Compile-time exhaustiveness check
  }
}

