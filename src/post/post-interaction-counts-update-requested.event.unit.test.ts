import { describe, expect, it } from 'vitest';

import { PostInteractionCountsUpdateRequestedEvent } from '@/post/post-interaction-counts-update-requested.event';

describe('PostInteractionCountsUpdateRequestedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(PostInteractionCountsUpdateRequestedEvent.getName()).toBe(
                'post.interaction-counts-update-requested',
            );
        });

        it('should return the event name from instance method', () => {
            const event = new PostInteractionCountsUpdateRequestedEvent([1]);

            expect(event.getName()).toBe(
                'post.interaction-counts-update-requested',
            );
        });
    });

    describe('getPostIds', () => {
        it('should return the post ids', () => {
            const event = new PostInteractionCountsUpdateRequestedEvent([
                1, 2, 3,
            ]);

            expect(event.getPostIds()).toEqual([1, 2, 3]);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new PostInteractionCountsUpdateRequestedEvent([
                1, 2, 3,
            ]);

            expect(event.toJSON()).toEqual({
                postIds: [1, 2, 3],
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = PostInteractionCountsUpdateRequestedEvent.fromJSON({
                postIds: [1, 2, 3],
            });

            expect(event.getPostIds()).toEqual([1, 2, 3]);
        });

        it('should throw an error if postIds is missing', () => {
            expect(() =>
                PostInteractionCountsUpdateRequestedEvent.fromJSON({}),
            ).toThrow('postIds must be an array');
        });

        it('should throw an error if postIds is not an array', () => {
            expect(() =>
                PostInteractionCountsUpdateRequestedEvent.fromJSON({
                    postIds: 'not an array',
                }),
            ).toThrow('postIds must be an array');
        });

        it('should throw an error if postIds is null', () => {
            expect(() =>
                PostInteractionCountsUpdateRequestedEvent.fromJSON({
                    postIds: null,
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

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new PostInteractionCountsUpdateRequestedEvent([
                1, 2, 3,
            ]);
            const json = original.toJSON();
            const restored =
                PostInteractionCountsUpdateRequestedEvent.fromJSON(json);

            expect(restored.getPostIds()).toEqual(original.getPostIds());
        });
    });
});
