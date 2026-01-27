import { describe, expect, it } from 'vitest';

import { PostDerepostedEvent } from '@/post/post-dereposted.event';

describe('PostDerepostedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(PostDerepostedEvent.getName()).toBe('post.dereposted');
        });

        it('should return the event name from instance method', () => {
            const event = new PostDerepostedEvent(123, 456);

            expect(event.getName()).toBe('post.dereposted');
        });
    });

    describe('getPostId', () => {
        it('should return the post id', () => {
            const event = new PostDerepostedEvent(123, 456);

            expect(event.getPostId()).toBe(123);
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new PostDerepostedEvent(123, 456);

            expect(event.getAccountId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new PostDerepostedEvent(123, 456);

            expect(event.toJSON()).toEqual({
                postId: 123,
                accountId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = PostDerepostedEvent.fromJSON({
                postId: 123,
                accountId: 456,
            });

            expect(event.getPostId()).toBe(123);
            expect(event.getAccountId()).toBe(456);
        });

        it('should throw an error if postId is missing', () => {
            expect(() =>
                PostDerepostedEvent.fromJSON({
                    accountId: 456,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is not a number', () => {
            expect(() =>
                PostDerepostedEvent.fromJSON({
                    postId: 'not a number',
                    accountId: 456,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is null', () => {
            expect(() =>
                PostDerepostedEvent.fromJSON({
                    postId: null,
                    accountId: 456,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                PostDerepostedEvent.fromJSON({
                    postId: 123,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                PostDerepostedEvent.fromJSON({
                    postId: 123,
                    accountId: 'not a number',
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                PostDerepostedEvent.fromJSON({
                    postId: 123,
                    accountId: null,
                }),
            ).toThrow('accountId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new PostDerepostedEvent(999, 888);
            const json = original.toJSON();
            const restored = PostDerepostedEvent.fromJSON(json);

            expect(restored.getPostId()).toBe(original.getPostId());
            expect(restored.getAccountId()).toBe(original.getAccountId());
        });
    });
});
