# Event-Driven Federation

## Status

Proposed

## Context

Outbound ActivityPub federation (`sendActivity` calls) is scattered across controllers, activity handlers, and services with inconsistent error handling:

- **Bare `await` (no try/catch):** Delivery failures crash the request with a 500, even though the local operation succeeded. This is the class of bug reported in BER-2715 - a note is posted successfully but `sendActivityToFollowers` throws when a follower's inbox is unreachable, and the error propagates back through `emitAsync` to the controller, producing a 500. The same pattern exists in the repost path (`post.controller.ts`) where a bare `await` on `sendActivity` means a dead inbox crashes the request.
- **Fire-and-forget (no `await`):** Delivery failures produce unhandled promise rejections.
- **Try/catch with logging:** The correct approach, but only used in one place.

There are 18 `sendActivity` calls outside the `FediverseBridge`, spread across `like.controller.ts`, `post.controller.ts`, `follow.controller.ts`, `follow.handler.ts`, and `bluesky.service.ts`. The `FediverseBridge` already handles 5 domain events correctly, demonstrating the target pattern.

Federation success should not determine whether a local operation succeeded. Controllers should not be coupled to federation delivery concerns.

This decision builds on [ADR-0011 (Serializable Domain Events)](0011-serializable-domain-events.md), which was a prerequisite for this work.

## Decision

All outbound federation must go through the `FediverseBridge`, triggered by domain events. Controllers and services must not call `sendActivity` directly.

### Scope

This applies to federation that is a **side effect of a domain operation** (e.g. liking a post federates a `Like` activity). It does not apply to:

- **Inbound activity responses** (e.g. `Accept` in `follow.handler.ts` in response to a received `Follow`) - these are responses to inbound activities and belong in the activity handler that processes them. Note: the `FediverseBridge` already handles `AccountBlockedEvent` -> `Reject(Follow)`, which is similar in shape but different in trigger - it is a domain event (blocking an account) that has a federation side effect, not a response to an inbound activity.
- **Integration-specific federation** (e.g. Bluesky/Bridgy bridge in `bluesky.service.ts`) - these use ActivityPub as a transport mechanism for integration protocols and should be handled by their own dedicated service.

### Consolidation

The `FedifyActivitySender` class in `src/activitypub/activity.ts` is a separate abstraction that also wraps `sendActivity`. Once all federation is routed through the `FediverseBridge`, `FedifyActivitySender` should be removed to avoid having two places that send activities.

## Implementation

### Pattern

The existing `FediverseBridge` handlers demonstrate the pattern. The controller does only the domain operation, the bridge handles federation:

```typescript
// 1. Controller does the domain operation only
async handleRepost(ctx: AppContext) {
    // postService calls postRepository.save(), which emits PostRepostedEvent
    await this.postService.repostByApId(account, postApId);
    return ok();
}

// 2. FediverseBridge listens for the event and federates
private async handlePostReposted(event: PostRepostedEvent) {
    const account = await this.accountService.getAccountById(
        event.getAccountId(),
    );
    const post = await this.postRepository.getById(event.getPostId());

    if (!account || !post || !post.author.isInternal) {
        return;
    }

    const ctx = this.fedifyContextFactory.getFedifyContext();
    const announce = await buildAnnounceActivityForPost(account, post, ctx);

    await this.sendActivityToInbox(account, post.author, announce);
    await this.sendActivityToFollowers(account, announce);
}
```

Some handlers need to send to both a specific inbox and followers (e.g. likes send to the attribution actor's inbox and to all followers, reposts send to the original author and followers). Handlers call both `sendActivityToInbox` and `sendActivityToFollowers` as needed.

### Error handling

The `FediverseBridge` helper methods (`sendActivityToFollowers`, `sendActivityToInbox`) should catch and log errors rather than throwing. Federation is best-effort - a failed delivery should not crash the event handler:

```typescript
private async sendActivityToFollowers(account: Account, activity: Activity) {
    const ctx = this.fedifyContextFactory.getFedifyContext();

    try {
        await ctx.sendActivity(
            { username: account.username },
            'followers',
            activity,
            { preferSharedInbox: true },
        );
    } catch (err) {
        this.logger.error('Failed to send activity {activityId} to followers of {account}', {
            activityId: activity.id?.href,
            account: account.username,
            error: err,
        });
    }
}
```

### New events required

Some domain operations do not currently emit events. These need to be created (following [ADR-0011](0011-serializable-domain-events.md)) before their federation can be moved to the bridge:

- `PostUnlikedEvent` - for federating `Undo(Like)`
- `FollowRequestedEvent` - for federating outbound `Follow` requests to external accounts

### Migration strategy

Each `sendActivity` call site is migrated independently in its own PR:

1. Create the bridge handler (and new event if needed)
2. Remove the `sendActivity` call from the controller/service
3. Verify with tests

This can be done incrementally - the codebase can have a mix of migrated and unmigrated call sites during the transition.

## Consequences

### Positive

- Federation happens in a single place, not scattered across the codebase
- Controllers and services are decoupled from Fedify
- Consistent error handling for all outbound federation
- Fixes the class of bugs where federation failure crashes the HTTP request (BER-2715)
- Federation is easier to reason about: "when domain event X occurs, federate activity Y"
- Enables future improvements like retry logic, dead letter queues, or federation metrics in one place

### Negative

- Bridge handlers need repository lookups to reconstruct context (slight latency, handled gracefully if entity is missing)
- `FediverseBridge` grows as more handlers are added - may need to be split into focused modules later
- Some federation requires data that isn't in the current event payloads, requiring either richer events or additional lookups

## Risks

- **Response latency:** `emitAsync` waits for all handlers, so federation delivery blocks the HTTP response (same as today). The try/catch fix prevents 500 errors but does not improve response times. Moving events to a message queue (which ADR-0011 enables) would make federation truly async and is the long-term solution.
- **globaldb coupling:** Many current `sendActivity` call sites also write activity JSON-LD to `globaldb`. This storage concern moves into the bridge handlers, coupling the bridge to `globaldb`. This is acceptable as `globaldb` is an implementation detail of ActivityPub federation.
- **Entity deletion race:** If an entity is deleted between event emission and handler execution, the repository lookup returns nothing. Handlers must handle this gracefully (early return). `PostDeletedEvent` already solves this by carrying all needed data inline.
