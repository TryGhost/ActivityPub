import { describe, expect, it } from 'vitest';

import { PostCreatedEvent } from '@/post/post-created.event';

describe('PostCreatedEvent', () => {
    it('should be serializable', () => {
        const event = new PostCreatedEvent(123);

        expect(event.toJSON()).toEqual({
            postId: 123,
        });
    });

    it('should be deserializable', () => {
        const event = PostCreatedEvent.fromJSON({
            postId: 123,
        });

        expect(event.getPostId()).toEqual(123);
    });

    it('should throw an error if postId is not a number', () => {
        expect(() =>
            PostCreatedEvent.fromJSON({
                postId: 'not a number',
            }),
        ).toThrow('postId must be a number');
    });

    it('should throw an error if postId is missing', () => {
        expect(() => PostCreatedEvent.fromJSON({})).toThrow(
            'postId must be a number',
        );
    });

    it('should return the correct event name', () => {
        expect(PostCreatedEvent.getName()).toBe('post.created');
    });
});
