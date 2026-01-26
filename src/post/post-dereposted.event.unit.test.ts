import { describe, expect, it } from 'vitest';

import { PostDerepostedEvent } from '@/post/post-dereposted.event';

describe('PostDerepostedEvent', () => {
    it('should return the postId via getter', () => {
        const event = new PostDerepostedEvent(123, 456);

        expect(event.getPostId()).toBe(123);
    });

    it('should return the accountId via getter', () => {
        const event = new PostDerepostedEvent(123, 456);

        expect(event.getAccountId()).toBe(456);
    });

    it('should return the correct event name', () => {
        expect(PostDerepostedEvent.getName()).toBe('post.dereposted');
    });

    it('should be serializable', () => {
        const event = new PostDerepostedEvent(123, 456);

        expect(event.toJSON()).toEqual({
            postId: 123,
            accountId: 456,
        });
    });

    it('should be deserializable', () => {
        const event = PostDerepostedEvent.fromJSON({
            postId: 123,
            accountId: 456,
        });

        expect(event.getPostId()).toBe(123);
        expect(event.getAccountId()).toBe(456);
    });

    it('should throw an error if postId is not a number', () => {
        expect(() =>
            PostDerepostedEvent.fromJSON({
                postId: 'not a number',
                accountId: 456,
            }),
        ).toThrow('postId must be a number');
    });

    it('should throw an error if accountId is not a number', () => {
        expect(() =>
            PostDerepostedEvent.fromJSON({
                postId: 123,
                accountId: 'not a number',
            }),
        ).toThrow('accountId must be a number');
    });
});
