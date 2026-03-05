import type { SerializableEvent } from '@/events/event';

export class PostDerepostedEvent implements SerializableEvent {
    constructor(
        private readonly postId: number,
        private readonly accountId: number,
    ) {}

    static getName(): string {
        return 'post.dereposted';
    }

    getName(): string {
        return PostDerepostedEvent.getName();
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

    static fromJSON(data: Record<string, unknown>): PostDerepostedEvent {
        if (typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new PostDerepostedEvent(data.postId, data.accountId);
    }
}
