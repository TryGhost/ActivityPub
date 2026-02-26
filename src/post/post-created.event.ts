import type { SerializableEvent } from '@/events/event';

export class PostCreatedEvent implements SerializableEvent {
    constructor(private readonly postId: number) {}

    getPostId(): number {
        return this.postId;
    }

    getName(): string {
        return PostCreatedEvent.getName();
    }

    static getName(): string {
        return 'post.created';
    }

    toJSON(): Record<string, unknown> {
        return {
            postId: this.postId,
        };
    }

    static fromJSON(data: Record<string, unknown>): PostCreatedEvent {
        if (typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }
        return new PostCreatedEvent(data.postId);
    }
}
