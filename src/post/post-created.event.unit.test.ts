import { describe, expect, it } from 'vitest';

import { PostCreatedEvent } from '@/post/post-created.event';

describe('PostCreatedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(PostCreatedEvent.getName()).toBe('post.created');
        });

        it('should return the event name from instance method', () => {
            const event = new PostCreatedEvent(123);

            expect(event.getName()).toBe('post.created');
        });
    });

    describe('getPostId', () => {
        it('should return the post id', () => {
            const event = new PostCreatedEvent(123);

            expect(event.getPostId()).toBe(123);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new PostCreatedEvent(123);

            expect(event.toJSON()).toEqual({
                postId: 123,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = PostCreatedEvent.fromJSON({
                postId: 123,
            });

            expect(event.getPostId()).toBe(123);
        });

        it('should throw an error if postId is missing', () => {
            expect(() => PostCreatedEvent.fromJSON({})).toThrow(
                'postId must be a number',
            );
        });

        it('should throw an error if postId is not a number', () => {
            expect(() =>
                PostCreatedEvent.fromJSON({
                    postId: 'not a number',
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is null', () => {
            expect(() =>
                PostCreatedEvent.fromJSON({
                    postId: null,
                }),
            ).toThrow('postId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new PostCreatedEvent(999);
            const json = original.toJSON();
            const restored = PostCreatedEvent.fromJSON(json);

            expect(restored.getPostId()).toBe(original.getPostId());
        });
    });
});
