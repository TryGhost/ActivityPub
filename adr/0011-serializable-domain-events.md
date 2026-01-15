# Serializable Domain Events

## Status

Proposed

## Context

Domain events need to be processed asynchronously via message queues for:
- Improved resilience (events survive process restarts)
- Distributed processing across multiple instances
- Decoupling event producers from consumers
- Cost-effective messaging (GCP Pub/Sub charges based on message size)

Embedding full entities in events prevents serialization and increases message sizes unnecessarily.

## Decision

All domain events must implement the `SerializableEvent` interface and contain only primitive, serializable data (IDs, strings, numbers, dates as ISO strings). Event consumers that need full entities must look them up via repositories.

## Implementation

### Interface

Events must implement `SerializableEvent` and provide a static `fromJSON` method for deserialization:

```typescript
// From src/events/event.ts
export interface SerializableEvent {
    toJSON(): Record<string, unknown>;
}

export interface DeserializableEventConstructor {
    fromJSON(data: Record<string, unknown>): SerializableEvent;
}
```

### Event Structure

```typescript
import type { SerializableEvent } from '@/events/event';

export class PostCreatedEvent implements SerializableEvent {
    constructor(
        private readonly postId: number,
        private readonly authorId: number,
    ) {}

    getPostId(): number { return this.postId; }

    getAuthorId(): number { return this.authorId; }

    static getName(): string { return 'post.created'; }

    toJSON(): Record<string, unknown> {
        return { postId: this.postId, authorId: this.authorId };
    }

    static fromJSON(data: Record<string, unknown>): PostCreatedEvent {
        if (typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }

        if (typeof data.authorId !== 'number') {
            throw new Error('authorId must be a number');
        }

        return new PostCreatedEvent(data.postId, data.authorId);
    }
}
```

```typescript
// Consumer looks up entities when needed
private async handlePostCreated(event: PostCreatedEvent) {
    const post = await this.postRepository.getById(event.getPostId());

    if (!post || !post.author.isInternal) {
        return;
    }

    // ... handle event
}
```

Events must be registered with the `EventSerializer` for Pub/Sub support:

```typescript
eventSerializer.register(PostCreatedEvent.getName(), PostCreatedEvent);
```

## Consequences

### Positive

- Events can be serialized to JSON and put on message queues
- Reduced memory footprint and message sizes
- Cleaner separation between event data and entity data
- Consistent event structure across the codebase
- Enables distributed event processing
- Cost-effective message queue usage (GCP Pub/Sub charges based on message size)

### Negative

- Event consumers need additional repository lookups
- Slightly more boilerplate in event classes (toJSON/fromJSON)
- No versioning strategy for schema evolution - adding/removing fields requires careful coordination between producers and consumers

## Risks

- Repository lookups in consumers could fail if an entity was deleted between event emission and handling - consumers must handle missing entities gracefully
- Events must include enough context (IDs) for consumers to look up what they need - under-specifying event data will require changes later
