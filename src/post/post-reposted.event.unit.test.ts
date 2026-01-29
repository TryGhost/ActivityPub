import { describe, expect, it } from 'vitest';

import { PostRepostedEvent } from '@/post/post-reposted.event';

describe('PostRepostedEvent', () => {
    it('should be serializable', () => {
        const event = new PostRepostedEvent(123, 456);

        expect(event.toJSON()).toEqual({
            postId: 123,
            accountId: 456,
        });
    });

    it('should be deserializable', () => {
        const event = PostRepostedEvent.fromJSON({
            postId: 123,
            accountId: 456,
        });

        expect(event.getPostId()).toEqual(123);
        expect(event.getAccountId()).toEqual(456);
    });

    it('should throw an error if postId is not a number', () => {
        expect(() =>
            PostRepostedEvent.fromJSON({
                postId: 'not a number',
                accountId: 456,
            }),
        ).toThrow('postId must be a number');
    });

    it('should throw an error if accountId is not a number', () => {
        expect(() =>
            PostRepostedEvent.fromJSON({
                postId: 123,
                accountId: 'not a number',
            }),
        ).toThrow('accountId must be a number');
    });

    it('should return the correct event name', () => {
        expect(PostRepostedEvent.getName()).toEqual('post.reposted');
    });
});
