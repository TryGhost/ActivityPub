# Use Result Type for Explicit Error Handling

## Status

Accepted

## Context

JavaScript/TypeScript's default error handling mechanism uses exceptions (`try/catch`), which has several problems:
- Errors are implicit - function signatures don't indicate what errors might occur
- Easy to forget error handling - uncaught exceptions crash the application
- Difficult to handle different error types in a type-safe way
- Stack unwinding makes control flow hard to follow

## Decision

Use the Result type pattern for all operations that can fail, forcing explicit error handling at compile time.

## Implementation

```typescript
// Basic Result type definition
export type Result<T, E = string> = [error: E, value: null] | [error: null, value: T];

// Helper functions force explicit error handling
export function isError<T, E>(result: Result<T, E>): result is [E, null] {
  return result[0] !== null;
}

export function getValue<T, E>(result: Result<T, E>): T {
  if (isError(result)) {
    throw new Error('Attempted to get value from error result');
  }
  return result[1];
}

export function getError<T, E>(result: Result<T, E>): E {
  if (!isError(result)) {
    throw new Error('Attempted to get error from success result');
  }
  return result[0];
}

// Usage example
async function findAccount(id: string): Promise<Result<Account, string>> {
  const account = await repository.findById(id);
  if (!account) {
    return error(`Account ${id} not found`);
  }
  return ok(account);
}

// Forced explicit handling
const result = await findAccount('123');
if (isError(result)) {
  console.error(getError(result));  // Type-safe error access
  return;
}
const account = getValue(result);  // Type-safe value access
```

## Benefits

1. **Explicit error handling** - Errors are part of the function signature
2. **Type safety** - TypeScript ensures all errors are handled
3. **No hidden exceptions** - All failure modes are visible

## Guidelines

- Use Result types for any operation that can fail
- Always use `isError()` to check before accessing values
- Use `getValue()` and `getError()` for type-safe access
- Never destructure Result directly - use the helper functions