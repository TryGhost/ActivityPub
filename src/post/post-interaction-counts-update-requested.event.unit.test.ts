import { describe, expect, it } from 'vitest';

import { PostInteractionCountsUpdateRequestedEvent } from './post-interaction-counts-update-requested.event';

describe('PostInteractionCountsUpdateRequestedEvent', () => {
    it('should be serializable', () => {
        const event = new PostInteractionCountsUpdateRequestedEvent([1, 2, 3]);

        expect(event.toJSON()).toEqual({
            postIds: [1, 2, 3],
        });
    });

    it('should be deserializable', () => {
        const event = PostInteractionCountsUpdateRequestedEvent.fromJSON({
            postIds: [1, 2, 3],
        });

        expect(event.getPostIds()).toEqual([1, 2, 3]);
    });

    it('should throw an error if postIds is not an array', () => {
        expect(() =>
            PostInteractionCountsUpdateRequestedEvent.fromJSON({
                postIds: 'not an array',
            }),
        ).toThrow('postIds must be an array');
    });

    it('should throw an error if postIds is not an array of numbers', () => {
        expect(() =>
            PostInteractionCountsUpdateRequestedEvent.fromJSON({
                postIds: [1, 'not a number'],
            }),
        ).toThrow('postIds must be an array of numbers');
    });
});
