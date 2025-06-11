import type { SerializableEvent } from 'events/event';

export class PostInteractionCountUpdateRequestedEvent
    implements SerializableEvent
{
    constructor(private readonly postIds: number[]) {}

    getPostIds(): number[] {
        return this.postIds;
    }

    static getName(): string {
        return 'posts.interaction-count-update-requested';
    }

    toJSON(): Record<string, unknown> {
        return {
            postIds: this.postIds,
        };
    }

    static fromJSON(
        data: Record<string, unknown>,
    ): PostInteractionCountUpdateRequestedEvent {
        if (!('postIds' in data) || !Array.isArray(data.postIds)) {
            throw new Error('postIds must be an array');
        }

        for (const postId of data.postIds) {
            if (typeof postId !== 'number') {
                throw new Error('postIds must be an array of numbers');
            }
        }

        return new PostInteractionCountUpdateRequestedEvent(data.postIds);
    }
}
