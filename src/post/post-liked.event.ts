import type { SerializableEvent } from '@/events/event';

export class PostLikedEvent implements SerializableEvent {
    constructor(
        private readonly postId: number,
        private readonly postAuthorId: number,
        private readonly accountId: number,
    ) {}

    getPostId(): number {
        return this.postId;
    }

    getPostAuthorId(): number {
        return this.postAuthorId;
    }

    getAccountId(): number {
        return this.accountId;
    }

    getName(): string {
        return PostLikedEvent.getName();
    }

    static getName(): string {
        return 'post.liked';
    }

    toJSON(): Record<string, unknown> {
        return {
            postId: this.postId,
            postAuthorId: this.postAuthorId,
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): PostLikedEvent {
        if (typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }
        if (typeof data.postAuthorId !== 'number') {
            throw new Error('postAuthorId must be a number');
        }
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new PostLikedEvent(
            data.postId,
            data.postAuthorId,
            data.accountId,
        );
    }
}
