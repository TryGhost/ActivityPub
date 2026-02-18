import { describe, expect, it } from 'vitest';

import { PostUpdatedEvent } from '@/post/post-updated.event';

describe('PostUpdatedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(PostUpdatedEvent.getName()).toBe('post.updated');
        });

        it('should return the event name from instance method', () => {
            const event = new PostUpdatedEvent(123);

            expect(event.getName()).toBe('post.updated');
        });
    });

    describe('getPostId', () => {
        it('should return the post id', () => {
            const event = new PostUpdatedEvent(123);

            expect(event.getPostId()).toBe(123);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new PostUpdatedEvent(123);

            expect(event.toJSON()).toEqual({
                postId: 123,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = PostUpdatedEvent.fromJSON({
                postId: 123,
            });

            expect(event.getPostId()).toBe(123);
        });

        it('should throw an error if postId is missing', () => {
            expect(() => PostUpdatedEvent.fromJSON({})).toThrow(
                'postId must be a number',
            );
        });

        it('should throw an error if postId is not a number', () => {
            expect(() =>
                PostUpdatedEvent.fromJSON({
                    postId: 'not a number',
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is null', () => {
            expect(() =>
                PostUpdatedEvent.fromJSON({
                    postId: null,
                }),
            ).toThrow('postId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new PostUpdatedEvent(999);
            const json = original.toJSON();
            const restored = PostUpdatedEvent.fromJSON(json);

            expect(restored.getPostId()).toBe(original.getPostId());
        });
    });
});
