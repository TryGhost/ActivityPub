import type { SerializableEvent } from '@/events/event';

export class PostInteractionCountsUpdateRequestedEvent
    implements SerializableEvent
{
    constructor(private readonly postIds: number[]) {}

    static getName(): string {
        return 'post.interaction-counts-update-requested';
    }

    getName(): string {
        return PostInteractionCountsUpdateRequestedEvent.getName();
    }

    getPostIds(): number[] {
        return this.postIds;
    }

    toJSON(): Record<string, unknown> {
        return {
            postIds: this.postIds,
        };
    }

    static fromJSON(
        data: Record<string, unknown>,
    ): PostInteractionCountsUpdateRequestedEvent {
        if (!('postIds' in data) || !Array.isArray(data.postIds)) {
            throw new Error('postIds must be an array');
        }

        for (const postId of data.postIds) {
            if (typeof postId !== 'number') {
                throw new Error('postIds must be an array of numbers');
            }
        }

        return new PostInteractionCountsUpdateRequestedEvent(data.postIds);
    }
}
