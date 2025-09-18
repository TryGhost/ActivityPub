# Use Class-Based Architecture

## Status

Accepted

## Context

The codebase mixes function-based factories (e.g., `createAnnounceHandler()`) with class-based services. The 1100+ line `dispatchers.ts` has become unmaintainable.

## Decision

Use classes for all services, handlers, dispatchers, and controllers.

## Implementation

```typescript
// Classes with dependency injection
export class FollowHandler {
  constructor(
    private readonly accountService: AccountService,
    private readonly notificationService: NotificationService
  ) {}

  async handle(ctx: Context, follow: Follow) {
    // implementation
  }
}

// Registration with Awilix
container.register('followHandler', asClass(FollowHandler).singleton())

