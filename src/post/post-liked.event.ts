import type { SerializableEvent } from '@/events/event';

export class PostLikedEvent implements SerializableEvent {
    constructor(
        private readonly postId: number,
        private readonly accountId: number,
    ) {}

    getPostId(): number {
        return this.postId;
    }

    getAccountId(): number {
        return this.accountId;
    }

    static getName(): string {
        return 'post.liked';
    }

    toJSON(): Record<string, unknown> {
        return {
            postId: this.postId,
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): PostLikedEvent {
        if (typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }
        return new PostLikedEvent(data.postId, data.accountId);
    }
}
