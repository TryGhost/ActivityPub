import { describe, expect, it } from 'vitest';

import { PostDeletedEvent } from '@/post/post-deleted.event';

describe('PostDeletedEvent', () => {
    const validData = {
        postId: 123,
        postApId: 'https://example.com/post/123',
        accountId: 456,
        authorApId: 'https://example.com/user/456',
        authorApFollowers: 'https://example.com/user/456/followers',
        authorUsername: 'testuser',
        authorIsInternal: true,
    };

    function createEvent() {
        return new PostDeletedEvent(
            validData.postId,
            validData.postApId,
            validData.accountId,
            validData.authorApId,
            validData.authorApFollowers,
            validData.authorUsername,
            validData.authorIsInternal,
        );
    }

    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(PostDeletedEvent.getName()).toBe('post.deleted');
        });

        it('should return the event name from instance method', () => {
            expect(createEvent().getName()).toBe('post.deleted');
        });
    });

    describe('getPostId', () => {
        it('should return the post id', () => {
            expect(createEvent().getPostId()).toBe(123);
        });
    });

    describe('getPostApId', () => {
        it('should return the post AP id', () => {
            expect(createEvent().getPostApId()).toBe(
                'https://example.com/post/123',
            );
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            expect(createEvent().getAccountId()).toBe(456);
        });
    });

    describe('getAuthorApId', () => {
        it('should return the author AP id', () => {
            expect(createEvent().getAuthorApId()).toBe(
                'https://example.com/user/456',
            );
        });
    });

    describe('getAuthorApFollowers', () => {
        it('should return the author AP followers URL', () => {
            expect(createEvent().getAuthorApFollowers()).toBe(
                'https://example.com/user/456/followers',
            );
        });
    });

    describe('getAuthorUsername', () => {
        it('should return the author username', () => {
            expect(createEvent().getAuthorUsername()).toBe('testuser');
        });
    });

    describe('isAuthorInternal', () => {
        it('should return whether the author is internal', () => {
            expect(createEvent().isAuthorInternal()).toBe(true);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            expect(createEvent().toJSON()).toEqual(validData);
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = PostDeletedEvent.fromJSON(validData);

            expect(event.getPostId()).toBe(123);
            expect(event.getPostApId()).toBe('https://example.com/post/123');
            expect(event.getAccountId()).toBe(456);
            expect(event.getAuthorApId()).toBe('https://example.com/user/456');
            expect(event.getAuthorApFollowers()).toBe(
                'https://example.com/user/456/followers',
            );
            expect(event.getAuthorUsername()).toBe('testuser');
            expect(event.isAuthorInternal()).toBe(true);
        });

        it('should throw an error if postId is missing', () => {
            const { postId: _, ...data } = validData;
            expect(() => PostDeletedEvent.fromJSON(data)).toThrow(
                'postId must be a number',
            );
        });

        it('should throw an error if postId is not a number', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({ ...validData, postId: 'bad' }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postId is null', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({ ...validData, postId: null }),
            ).toThrow('postId must be a number');
        });

        it('should throw an error if postApId is missing', () => {
            const { postApId: _, ...data } = validData;
            expect(() => PostDeletedEvent.fromJSON(data)).toThrow(
                'postApId must be a string',
            );
        });

        it('should throw an error if postApId is not a string', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({ ...validData, postApId: 123 }),
            ).toThrow('postApId must be a string');
        });

        it('should throw an error if accountId is missing', () => {
            const { accountId: _, ...data } = validData;
            expect(() => PostDeletedEvent.fromJSON(data)).toThrow(
                'accountId must be a number',
            );
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({ ...validData, accountId: 'bad' }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if authorApId is missing', () => {
            const { authorApId: _, ...data } = validData;
            expect(() => PostDeletedEvent.fromJSON(data)).toThrow(
                'authorApId must be a string',
            );
        });

        it('should throw an error if authorApId is not a string', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({ ...validData, authorApId: 123 }),
            ).toThrow('authorApId must be a string');
        });

        it('should throw an error if authorApFollowers is missing', () => {
            const { authorApFollowers: _, ...data } = validData;
            expect(() => PostDeletedEvent.fromJSON(data)).toThrow(
                'authorApFollowers must be a string',
            );
        });

        it('should throw an error if authorApFollowers is not a string', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({
                    ...validData,
                    authorApFollowers: 123,
                }),
            ).toThrow('authorApFollowers must be a string');
        });

        it('should throw an error if authorUsername is missing', () => {
            const { authorUsername: _, ...data } = validData;
            expect(() => PostDeletedEvent.fromJSON(data)).toThrow(
                'authorUsername must be a string',
            );
        });

        it('should throw an error if authorUsername is not a string', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({
                    ...validData,
                    authorUsername: 123,
                }),
            ).toThrow('authorUsername must be a string');
        });

        it('should throw an error if authorIsInternal is missing', () => {
            const { authorIsInternal: _, ...data } = validData;
            expect(() => PostDeletedEvent.fromJSON(data)).toThrow(
                'authorIsInternal must be a boolean',
            );
        });

        it('should throw an error if authorIsInternal is not a boolean', () => {
            expect(() =>
                PostDeletedEvent.fromJSON({
                    ...validData,
                    authorIsInternal: 'bad',
                }),
            ).toThrow('authorIsInternal must be a boolean');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = createEvent();
            const json = original.toJSON();
            const restored = PostDeletedEvent.fromJSON(json);

            expect(restored.getPostId()).toBe(original.getPostId());
            expect(restored.getPostApId()).toBe(original.getPostApId());
            expect(restored.getAccountId()).toBe(original.getAccountId());
            expect(restored.getAuthorApId()).toBe(original.getAuthorApId());
            expect(restored.getAuthorApFollowers()).toBe(
                original.getAuthorApFollowers(),
            );
            expect(restored.getAuthorUsername()).toBe(
                original.getAuthorUsername(),
            );
            expect(restored.isAuthorInternal()).toBe(
                original.isAuthorInternal(),
            );
        });
    });
});
