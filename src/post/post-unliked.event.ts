import type { SerializableEvent } from '@/events/event';

export class PostUnlikedEvent implements SerializableEvent {
    constructor(
        private readonly postId: number,
        private readonly accountId: number,
    ) {}

    static getName(): string {
        return 'post.unliked';
    }

    getName(): string {
        return PostUnlikedEvent.getName();
    }

    getPostId(): number {
        return this.postId;
    }

    getAccountId(): number {
        return this.accountId;
    }

    toJSON(): Record<string, unknown> {
        return {
            postId: this.postId,
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): PostUnlikedEvent {
        const { postId, accountId } = data;

        if (typeof postId !== 'number' || !Number.isSafeInteger(postId)) {
            throw new Error('postId must be a safe integer');
        }

        if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId)) {
            throw new Error('accountId must be a safe integer');
        }

        return new PostUnlikedEvent(postId, accountId);
    }
}
