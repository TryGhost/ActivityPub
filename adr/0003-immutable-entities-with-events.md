# Use Immutable Entities with Domain Events

## Status

Accepted

## Context

The codebase has two conflicting entity patterns:
- **AccountEntity**: Immutable, generates domain events internally
- **Post**: Mutable with dirty flags and complex state tracking

The mutable pattern is harder to test and reason about.

## Decision

All entities must follow the immutable pattern with domain events.

## Implementation

```typescript
class Post {
  constructor(
    readonly id: string,
    readonly likeCount: number,
    private events: DomainEvent[] = []
  ) {}

  like(): Post {
    const newPost = new Post(this.id, this.likeCount + 1);
    newPost.events.push(new PostLikedEvent(this.id));
    return newPost;
  }

  pullEvents(): DomainEvent[] {
    return [...this.events];
  }
}

