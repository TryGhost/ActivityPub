# 6. Event-Driven Architecture

Date: 2025-01-18

## Status

Accepted

## Context

Synchronous processing of federation activities, notifications, and webhooks creates performance bottlenecks and tight coupling. We need asynchronous, decoupled processing with retry support that scales horizontally.

## Decision

Implement event-driven architecture with pluggable event bus: AsyncEvents (development) and Google Cloud Pub/Sub (production).

### Event Definition

```typescript
export class PostPublishedEvent {
    static getName() { return 'post.published'; }

    constructor(
        public readonly postId: string,
        public readonly accountId: string,
        public readonly url: string
    ) {}
}
```

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

### Service Integration

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

```typescript
export class FeedUpdateService {
    init() {
        this.events.on('post.published', async (event: PostPublishedEvent) => {
            await this.updateFollowerFeeds(event.accountId, event.postId);
        });
    }

    private async updateFollowerFeeds(accountId: string, postId: string) {
        const followers = await this.followersService.getFollowers(accountId);
        await Promise.all(followers.map(f => this.addToFeed(f.id, postId)));
    }
}
```

## Consequences

### Positive

- Loose coupling between components
- Horizontal scaling capability
- Built-in retry mechanisms
- Easy handler addition
- Synchronous testing mode

### Negative

- Eventual consistency
- Complex debugging of event chains
- No guaranteed message ordering in distributed mode

## Implementation Notes

### Event Bus Abstraction

```typescript
// Development: In-process events
export class AsyncEvents {
    private handlers = new Map<string, Handler[]>();

    emit(event: Event): Promise<void> {
        const handlers = this.handlers.get(event.constructor.getName());
        return Promise.all(handlers?.map(h => h(event)) || []);
    }
}

// Production: Google Cloud Pub/Sub
export class PubSubEvents {
    async emit(event: Event): Promise<void> {
        const message = {
            type: event.constructor.getName(),
            data: this.serializer.serialize(event)
        };
        await this.pubsub.topic(this.topic).publish(
            Buffer.from(JSON.stringify(message))
        );
    }
}
```

### Testing

```typescript
it('emits event on publish', async () => {
    const emitted: Event[] = [];
    events.on('post.published', async (e) => emitted.push(e));

    await service.publishPost(data);

    expect(emitted[0]).toBeInstanceOf(PostPublishedEvent);
});
```

### Key Patterns

- Events are classes with static `getName()` method
- Domain events use past tense (AccountFollowedEvent)
- Command events use imperative (SendNotificationCommand)
- Environment variable `USE_MQ` controls bus selection

## References

- [Event-Driven Architecture](https://martinfowler.com/articles/201701-event-driven.html)
- [Google Cloud Pub/Sub](https://cloud.google.com/pubsub/docs)