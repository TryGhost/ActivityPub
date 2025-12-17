# Best-Effort Activity Delivery

## Status

Accepted

## Context

When sending ActivityPub activities to remote servers, delivery can fail for various reasons: the remote server may be down, unreachable, slow, or return errors. The behavior of `sendActivity` varies based on whether a message queue (MQ) is configured:

**With MQ (`USE_MQ=true`):**
- Fedify queues activities for delivery with automatic retries
- `sendActivity` returns quickly after queueing (rarely fails)
- Delivery failures are handled asynchronously via `onOutboxError`

**Without MQ (`USE_MQ=false`):**
- Fedify sends HTTP requests synchronously using `Promise.all`
- If ANY recipient's server fails, the entire `sendActivity` call throws
- Successful deliveries have already occurred before the error
- User retries cause duplicate deliveries to already-successful recipients

This created inconsistent error handling across the codebase:
- Some calls awaited without try/catch (could fail user requests)
- Some calls used fire-and-forget (silent failures, no visibility)
- One call had try/catch (inconsistent pattern)

## Decision

Treat all outgoing activity delivery as **best-effort**:

1. User actions should never fail due to federation issues
2. All `sendActivity` calls use a wrapper that catches and logs errors
3. Errors are logged for visibility but not propagated
4. The pattern is consistent regardless of MQ configuration

## Implementation

The `ActivitySender` class is injected via Awilix dependency injection and provides two methods:

```typescript
// Inject ActivitySender via constructor
constructor(
    private readonly activitySender: ActivitySender,
) {}

// Send to a specific recipient
await this.activitySender.sendActivityToRecipient(
    { username: account.username },
    recipient,  // Actor or { id, inboxId }
    activity,
);

// Send to all followers (uses shared inbox optimization)
await this.activitySender.sendActivityToFollowers(
    { username: account.username },
    activity,
);
```

The `ActivitySender` class:
- Wraps Fedify's `sendActivity` in try/catch
- Logs failures with context (activity type, ID, recipient, queue status)
- Never throws, allowing the calling code to continue
- Uses `preferSharedInbox: true` for follower delivery

## Consequences

**Benefits:**
- User actions (posting, liking, following) never fail due to remote server issues
- Consistent error handling across all federation code
- Visibility into delivery failures via logging
- No duplicate deliveries from user retries (request succeeds first time)

**Trade-offs:**
- Delivery failures are "silent" from the user's perspective (logged, not shown)
- No application-level retry mechanism in non-MQ mode
- Callers cannot react to delivery failures

**Mitigations:**
- Logging provides operational visibility
- Users should be encouraged to use MQ mode for production (enables Fedify's retry mechanism)
- ActivityPub is inherently eventually consistent; failed deliveries may be retried by the remote server's backfill mechanisms
