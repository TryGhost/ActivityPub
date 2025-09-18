# 6. Event-Driven Architecture

Date: 2025-01-18

## Status

Accepted

## Context

The ActivityPub server needs to handle asynchronous operations like federation activities, notifications, and Ghost webhook processing. Synchronous processing would create performance bottlenecks and tight coupling between components.

Key requirements:
- Decouple activity processing from HTTP requests
- Enable horizontal scaling
- Support retry mechanisms for failed operations
- Allow both in-process and distributed event processing

## Decision

We will use an event-driven architecture with two event bus implementations: AsyncEvents for local development and Google Cloud Pub/Sub for production.

### Event Definition

Events are classes with serialization support:

```typescript
export class AccountCreatedEvent {
    static getName() { return 'account.created'; }

    constructor(
        public readonly accountId: string,
        public readonly username: string,
        public readonly siteId: string
    ) {}
}

export class PostPublishedEvent {
    static getName() { return 'post.published'; }

    constructor(
        public readonly postId: string,
        public readonly accountId: string,
        public readonly url: string
    ) {}
}
```

### Event Bus Abstraction

The system uses a common interface with switchable implementations:

```typescript
// Development: In-process events
export class AsyncEvents {
    private handlers = new Map<string, Handler[]>();

    emit(event: Event): Promise<void> {
        const handlers = this.handlers.get(event.constructor.getName());
        return Promise.all(handlers?.map(h => h(event)) || []);
    }

    on(eventName: string, handler: Handler): void {
        const handlers = this.handlers.get(eventName) || [];
        handlers.push(handler);
        this.handlers.set(eventName, handlers);
    }
}

// Production: Google Cloud Pub/Sub
export class PubSubEvents {
    constructor(
        private pubsub: PubSub,
        private topic: string,
        private serializer: EventSerializer
    ) {}

    async emit(event: Event): Promise<void> {
        const message = {
            type: event.constructor.getName(),
            data: this.serializer.serialize(event)
        };
        await this.pubsub.topic(this.topic).publish(Buffer.from(JSON.stringify(message)));
    }
}
```

### Service Integration

Services emit events for side effects:

```typescript
export class PostService {
    constructor(
        private postRepository: KnexPostRepository,
        private events: AsyncEvents  // Or PubSubEvents via DI
    ) {}

    async publishPost(data: PublishData): Promise<Result<Post, Error>> {
        const post = await this.postRepository.create(data);

        // Emit event for async processing
        await this.events.emit(new PostPublishedEvent(
            post.id,
            post.accountId,
            post.url
        ));

        return { ok: true, value: post };
    }
}
```

### Event Handlers

Handlers process events asynchronously:

```typescript
export class FeedUpdateService {
    init() {
        this.events.on('post.published', async (event: PostPublishedEvent) => {
            await this.updateFollowerFeeds(event.accountId, event.postId);
        });

        this.events.on('post.deleted', async (event: PostDeletedEvent) => {
            await this.removeFromFeeds(event.postId);
        });
    }

    private async updateFollowerFeeds(accountId: string, postId: string) {
        const followers = await this.followersService.getFollowers(accountId);
        // Update each follower's feed
        await Promise.all(followers.map(f => this.addToFeed(f.id, postId)));
    }
}
```

## Consequences

### Positive

1. **Loose coupling**: Components communicate via events, not direct calls
2. **Scalability**: Async processing enables horizontal scaling
3. **Resilience**: Failed events can be retried
4. **Flexibility**: Easy to add new event handlers
5. **Testability**: Can use synchronous events in tests

### Negative

1. **Eventual consistency**: Async processing means delayed updates
2. **Debugging complexity**: Event chains harder to trace
3. **Message ordering**: No guaranteed order in distributed system

## Implementation

### Event Patterns

#### 1. Command Events (Imperative)
```typescript
// Triggers specific action
class SendNotificationCommand {
    constructor(public userId: string, public message: string) {}
}
```

#### 2. Domain Events (Past Tense)
```typescript
// Something that happened
class AccountFollowedEvent {
    constructor(public followerId: string, public followeeId: string) {}
}
```

### Configuration

Environment-based bus selection:

```typescript
// In registrations.ts
if (process.env.USE_MQ === 'true') {
    container.register('commandBus', aliasTo('pubSubEvents'));
} else {
    container.register('commandBus', asValue(new AsyncEvents()));
}
```

### Testing Strategy

```typescript
describe('PostService', () => {
    let events: AsyncEvents;
    let service: PostService;

    beforeEach(() => {
        events = new AsyncEvents();
        service = new PostService(mockRepo, events);
    });

    it('should emit event on publish', async () => {
        const emitted: Event[] = [];
        events.on('post.published', async (e) => emitted.push(e));

        await service.publishPost(data);

        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toBeInstanceOf(PostPublishedEvent);
    });
});
```

### Pub/Sub Configuration

Production setup with retry handling:

```typescript
export class GCloudPubSubPushMessageQueue {
    constructor(
        private pubsub: PubSub,
        private topic: string,
        private useRetryTopic: boolean,
        private retryTopic: string,
        private maxDeliveryAttempts: number
    ) {}

    async publish(message: Message): Promise<void> {
        const attributes = {
            deliveryAttempt: '1',
            maxAttempts: this.maxDeliveryAttempts.toString()
        };

        await this.pubsub.topic(this.topic)
            .publish(Buffer.from(JSON.stringify(message)), attributes);
    }

    async handleFailure(message: Message, attempt: number): Promise<void> {
        if (attempt < this.maxDeliveryAttempts && this.useRetryTopic) {
            // Retry with exponential backoff
            await this.pubsub.topic(this.retryTopic).publish(message);
        } else {
            // Dead letter queue or log
            this.logging.error('Message failed after max attempts', { message });
        }
    }
}
```

## References

- [Event-Driven Architecture](https://martinfowler.com/articles/201701-event-driven.html)
- [Google Cloud Pub/Sub](https://cloud.google.com/pubsub/docs)
- Current implementation: `/src/events/`, `/src/pubsub.ts`