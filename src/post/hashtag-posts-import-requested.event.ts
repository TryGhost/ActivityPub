import type { SerializableEvent } from '@/events/event';

export class HashtagPostsImportRequestedEvent implements SerializableEvent {
    constructor(private readonly hashtag: string) {}

    static getName(): string {
        return 'hashtag.posts-import-requested';
    }

    getName(): string {
        return HashtagPostsImportRequestedEvent.getName();
    }

    getHashtag(): string {
        return this.hashtag;
    }

    toJSON(): Record<string, unknown> {
        return {
            hashtag: this.hashtag,
        };
    }

    static fromJSON(
        data: Record<string, unknown>,
    ): HashtagPostsImportRequestedEvent {
        if (typeof data.hashtag !== 'string') {
            throw new Error('hashtag must be a string');
        }

        return new HashtagPostsImportRequestedEvent(data.hashtag);
    }
}
