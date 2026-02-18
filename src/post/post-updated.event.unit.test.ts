import { describe, expect, it } from 'vitest';

import { PostUpdatedEvent } from '@/post/post-updated.event';

describe('PostUpdatedEvent', () => {
    it('should be serializable', () => {
        const event = new PostUpdatedEvent(123);

        expect(event.toJSON()).toEqual({
            postId: 123,
        });
    });

    it('should be deserializable', () => {
        const event = PostUpdatedEvent.fromJSON({
            postId: 456,
        });

        expect(event.getPostId()).toEqual(456);
    });

    it('should throw an error if postId is not a number', () => {
        expect(() =>
            PostUpdatedEvent.fromJSON({
                postId: 'not a number',
            }),
        ).toThrow('postId must be a number');
    });

    it('should throw an error if postId is missing', () => {
        expect(() => PostUpdatedEvent.fromJSON({})).toThrow(
            'postId must be a number',
        );
    });

    it('should return the correct event name', () => {
        expect(PostUpdatedEvent.getName()).toEqual('post.updated');
    });
});
