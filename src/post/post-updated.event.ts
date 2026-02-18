import type { SerializableEvent } from '@/events/event';

export class PostUpdatedEvent implements SerializableEvent {
    constructor(private readonly postId: number) {}

    getPostId(): number {
        return this.postId;
    }

    getName(): string {
        return PostUpdatedEvent.getName();
    }

    static getName(): string {
        return 'post.updated';
    }

    toJSON(): Record<string, unknown> {
        return {
            postId: this.postId,
        };
    }

    static fromJSON(data: Record<string, unknown>): PostUpdatedEvent {
        if (typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }
        return new PostUpdatedEvent(data.postId);
    }
}
