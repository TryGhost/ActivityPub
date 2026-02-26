import type { SerializableEvent } from '@/events/event';

export class PostDeletedEvent implements SerializableEvent {
    constructor(
        private readonly postId: number,
        private readonly postApId: string,
        private readonly accountId: number,
        private readonly authorApId: string,
        private readonly authorApFollowers: string,
        private readonly authorUsername: string,
        private readonly authorIsInternal: boolean,
    ) {}

    getPostId(): number {
        return this.postId;
    }

    getPostApId(): string {
        return this.postApId;
    }

    getAccountId(): number {
        return this.accountId;
    }

    getAuthorApId(): string {
        return this.authorApId;
    }

    getAuthorApFollowers(): string {
        return this.authorApFollowers;
    }

    getAuthorUsername(): string {
        return this.authorUsername;
    }

    isAuthorInternal(): boolean {
        return this.authorIsInternal;
    }

    static getName(): string {
        return 'post.deleted';
    }

    toJSON(): Record<string, unknown> {
        return {
            postId: this.postId,
            postApId: this.postApId,
            accountId: this.accountId,
            authorApId: this.authorApId,
            authorApFollowers: this.authorApFollowers,
            authorUsername: this.authorUsername,
            authorIsInternal: this.authorIsInternal,
        };
    }

    static fromJSON(data: Record<string, unknown>): PostDeletedEvent {
        if (!('postId' in data) || typeof data.postId !== 'number') {
            throw new Error('postId must be a number');
        }

        if (!('postApId' in data) || typeof data.postApId !== 'string') {
            throw new Error('postApId must be a string');
        }

        if (!('accountId' in data) || typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        if (!('authorApId' in data) || typeof data.authorApId !== 'string') {
            throw new Error('authorApId must be a string');
        }

        if (
            !('authorApFollowers' in data) ||
            typeof data.authorApFollowers !== 'string'
        ) {
            throw new Error('authorApFollowers must be a string');
        }

        if (
            !('authorUsername' in data) ||
            typeof data.authorUsername !== 'string'
        ) {
            throw new Error('authorUsername must be a string');
        }

        if (
            !('authorIsInternal' in data) ||
            typeof data.authorIsInternal !== 'boolean'
        ) {
            throw new Error('authorIsInternal must be a boolean');
        }

        return new PostDeletedEvent(
            data.postId,
            data.postApId,
            data.accountId,
            data.authorApId,
            data.authorApFollowers,
            data.authorUsername,
            data.authorIsInternal,
        );
    }
}
