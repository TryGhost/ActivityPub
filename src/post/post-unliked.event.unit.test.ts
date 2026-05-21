import { describe, expect, it } from 'vitest';

import { PostUnlikedEvent } from '@/post/post-unliked.event';

describe('PostUnlikedEvent', () => {
    it('returns the event name', () => {
        expect(PostUnlikedEvent.getName()).toBe('post.unliked');
        expect(new PostUnlikedEvent(1, 2).getName()).toBe('post.unliked');
    });

    it('serializes and deserializes', () => {
        const event = new PostUnlikedEvent(123, 456);
        const json = event.toJSON();

        expect(json).toEqual({
            postId: 123,
            accountId: 456,
        });
        expect(PostUnlikedEvent.fromJSON(json).getPostId()).toBe(123);
        expect(PostUnlikedEvent.fromJSON(json).getAccountId()).toBe(456);
    });

    it('validates postId', () => {
        expect(() =>
            PostUnlikedEvent.fromJSON({
                postId: '123',
                accountId: 456,
            }),
        ).toThrow('postId must be a safe integer');

        expect(() =>
            PostUnlikedEvent.fromJSON({
                postId: Number.NaN,
                accountId: 456,
            }),
        ).toThrow('postId must be a safe integer');

        expect(() =>
            PostUnlikedEvent.fromJSON({
                postId: Number.POSITIVE_INFINITY,
                accountId: 456,
            }),
        ).toThrow('postId must be a safe integer');
    });

    it('validates accountId', () => {
        expect(() =>
            PostUnlikedEvent.fromJSON({
                postId: 123,
                accountId: '456',
            }),
        ).toThrow('accountId must be a safe integer');

        expect(() =>
            PostUnlikedEvent.fromJSON({
                postId: 123,
                accountId: Number.NaN,
            }),
        ).toThrow('accountId must be a safe integer');

        expect(() =>
            PostUnlikedEvent.fromJSON({
                postId: 123,
                accountId: Number.POSITIVE_INFINITY,
            }),
        ).toThrow('accountId must be a safe integer');
    });
});
