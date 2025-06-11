import { describe, expect, it } from 'vitest';
import { PostInteractionCountUpdateRequestedEvent } from './post-interaction-count-update-requested.event';

describe('PostInteractionCountUpdateRequestedEvent', () => {
    it('should be serializable', () => {
        const event = new PostInteractionCountUpdateRequestedEvent([1, 2, 3]);

        expect(event.toJSON()).toEqual({
            postIds: [1, 2, 3],
        });
    });

    it('should be deserializable', () => {
        const event = PostInteractionCountUpdateRequestedEvent.fromJSON({
            postIds: [1, 2, 3],
        });

        expect(event.getPostIds()).toEqual([1, 2, 3]);
    });

    it('should throw an error if postIds is not an array', () => {
        expect(() =>
            PostInteractionCountUpdateRequestedEvent.fromJSON({
                postIds: 'not an array',
            }),
        ).toThrow('postIds must be an array');
    });

    it('should throw an error if postIds is not an array of numbers', () => {
        expect(() =>
            PostInteractionCountUpdateRequestedEvent.fromJSON({
                postIds: [1, 'not a number'],
            }),
        ).toThrow('postIds must be an array of numbers');
    });
});
