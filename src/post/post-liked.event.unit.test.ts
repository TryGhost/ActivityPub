import { describe, expect, it } from 'vitest';

import { PostLikedEvent } from '@/post/post-liked.event';

describe('PostLikedEvent', () => {
    it('should be serializable', () => {
        const event = new PostLikedEvent(123, 456, 789);

        expect(event.toJSON()).toEqual({
            postId: 123,
            postAuthorId: 456,
            accountId: 789,
        });
    });

    it('should be deserializable', () => {
        const event = PostLikedEvent.fromJSON({
            postId: 123,
            postAuthorId: 456,
            accountId: 789,
        });

        expect(event.getPostId()).toBe(123);
        expect(event.getPostAuthorId()).toBe(456);
        expect(event.getAccountId()).toBe(789);
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

    it('should throw an error if postAuthorId is not a number', () => {
        expect(() =>
            PostLikedEvent.fromJSON({
                postId: 123,
                postAuthorId: 'not a number',
                accountId: 789,
            }),
        ).toThrow('postAuthorId must be a number');
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

    it('should return the correct event name', () => {
        expect(PostLikedEvent.getName()).toBe('post.liked');
    });
});
