import { describe, expect, it } from 'vitest';

import { PostLikedEvent } from '@/post/post-liked.event';

describe('PostLikedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(PostLikedEvent.getName()).toBe('post.liked');
        });

        it('should return the event name from instance method', () => {
            const event = new PostLikedEvent(123, 456, 789);

            expect(event.getName()).toBe('post.liked');
        });
    });

    describe('getPostId', () => {
        it('should return the post id', () => {
            const event = new PostLikedEvent(123, 456, 789);

            expect(event.getPostId()).toBe(123);
        });
    });

    describe('getPostAuthorId', () => {
        it('should return the post author id', () => {
            const event = new PostLikedEvent(123, 456, 789);

            expect(event.getPostAuthorId()).toBe(456);
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new PostLikedEvent(123, 456, 789);

            expect(event.getAccountId()).toBe(789);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new PostLikedEvent(123, 456, 789);

            expect(event.toJSON()).toEqual({
                postId: 123,
                postAuthorId: 456,
                accountId: 789,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = PostLikedEvent.fromJSON({
                postId: 123,
                postAuthorId: 456,
                accountId: 789,
            });

            expect(event.getPostId()).toBe(123);
            expect(event.getPostAuthorId()).toBe(456);
            expect(event.getAccountId()).toBe(789);
        });

        it('should throw an error if postId is missing', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postAuthorId: 456,
                    accountId: 789,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is not a number', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: 'not a number',
                    postAuthorId: 456,
                    accountId: 789,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is null', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: null,
                    postAuthorId: 456,
                    accountId: 789,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postAuthorId is missing', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: 123,
                    accountId: 789,
                }),
            ).toThrow('postAuthorId must be a number');
        });

        it('should throw an error if postAuthorId is not a number', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: 123,
                    postAuthorId: 'not a number',
                    accountId: 789,
                }),
            ).toThrow('postAuthorId must be a number');
        });

        it('should throw an error if postAuthorId is null', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: 123,
                    postAuthorId: null,
                    accountId: 789,
                }),
            ).toThrow('postAuthorId must be a number');
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: 123,
                    postAuthorId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: 123,
                    postAuthorId: 456,
                    accountId: 'not a number',
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                PostLikedEvent.fromJSON({
                    postId: 123,
                    postAuthorId: 456,
                    accountId: null,
                }),
            ).toThrow('accountId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new PostLikedEvent(999, 888, 777);
            const json = original.toJSON();
            const restored = PostLikedEvent.fromJSON(json);

            expect(restored.getPostId()).toBe(original.getPostId());
            expect(restored.getPostAuthorId()).toBe(original.getPostAuthorId());
            expect(restored.getAccountId()).toBe(original.getAccountId());
        });
    });
});
