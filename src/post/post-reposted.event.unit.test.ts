import { describe, expect, it } from 'vitest';

import { PostRepostedEvent } from '@/post/post-reposted.event';

describe('PostRepostedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(PostRepostedEvent.getName()).toBe('post.reposted');
        });

        it('should return the event name from instance method', () => {
            const event = new PostRepostedEvent(123, 456);

            expect(event.getName()).toBe('post.reposted');
        });
    });

    describe('getPostId', () => {
        it('should return the post id', () => {
            const event = new PostRepostedEvent(123, 456);

            expect(event.getPostId()).toBe(123);
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new PostRepostedEvent(123, 456);

            expect(event.getAccountId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new PostRepostedEvent(123, 456);

            expect(event.toJSON()).toEqual({
                postId: 123,
                accountId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = PostRepostedEvent.fromJSON({
                postId: 123,
                accountId: 456,
            });

            expect(event.getPostId()).toBe(123);
            expect(event.getAccountId()).toBe(456);
        });

        it('should throw an error if postId is missing', () => {
            expect(() =>
                PostRepostedEvent.fromJSON({
                    accountId: 456,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is not a number', () => {
            expect(() =>
                PostRepostedEvent.fromJSON({
                    postId: 'not a number',
                    accountId: 456,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is null', () => {
            expect(() =>
                PostRepostedEvent.fromJSON({
                    postId: null,
                    accountId: 456,
                }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                PostRepostedEvent.fromJSON({
                    postId: 123,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                PostRepostedEvent.fromJSON({
                    postId: 123,
                    accountId: 'not a number',
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                PostRepostedEvent.fromJSON({
                    postId: 123,
                    accountId: null,
                }),
            ).toThrow('accountId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new PostRepostedEvent(999, 888);
            const json = original.toJSON();
            const restored = PostRepostedEvent.fromJSON(json);

            expect(restored.getPostId()).toBe(original.getPostId());
            expect(restored.getAccountId()).toBe(original.getAccountId());
        });
    });
});
