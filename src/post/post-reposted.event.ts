import type { SerializableEvent } from '@/events/event';

export class PostRepostedEvent implements SerializableEvent {
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
        return 'post.reposted';
    }

    getName(): string {
        return PostRepostedEvent.getName();
    }

    toJSON(): Record<string, unknown> {
        return {
            postId: this.postId,
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): PostRepostedEvent {
        if (typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new PostRepostedEvent(data.postId, data.accountId);
    }
}
