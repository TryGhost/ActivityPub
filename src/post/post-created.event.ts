import type { SerializableEvent } from '@/events/event';

export class PostCreatedEvent implements SerializableEvent {
    constructor(private readonly postId: number) {}

    static getName(): string {
        return 'post.created';
    }

    getName(): string {
        return PostCreatedEvent.getName();
    }

    getPostId(): number {
        return this.postId;
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
