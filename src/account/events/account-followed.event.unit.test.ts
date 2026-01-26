import { describe, expect, it } from 'vitest';

import { AccountFollowedEvent } from '@/account/events/account-followed.event';

describe('AccountFollowedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(AccountFollowedEvent.getName()).toBe('account.followed');
        });

        it('should return the event name from instance method', () => {
            const event = new AccountFollowedEvent(123, 456);

            expect(event.getName()).toBe('account.followed');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new AccountFollowedEvent(123, 456);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('getFollowerId', () => {
        it('should return the follower id', () => {
            const event = new AccountFollowedEvent(123, 456);

            expect(event.getFollowerId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountFollowedEvent(123, 456);

            expect(event.toJSON()).toEqual({
                accountId: 123,
                followerId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = AccountFollowedEvent.fromJSON({
                accountId: 123,
                followerId: 456,
            });

            expect(event.getAccountId()).toBe(123);
            expect(event.getFollowerId()).toBe(456);
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                AccountFollowedEvent.fromJSON({
                    followerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                AccountFollowedEvent.fromJSON({
                    accountId: 'not a number',
                    followerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                AccountFollowedEvent.fromJSON({
                    accountId: null,
                    followerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if followerId is missing', () => {
            expect(() =>
                AccountFollowedEvent.fromJSON({
                    accountId: 123,
                }),
            ).toThrow('followerId must be a number');
        });

        it('should throw an error if followerId is not a number', () => {
            expect(() =>
                AccountFollowedEvent.fromJSON({
                    accountId: 123,
                    followerId: 'not a number',
                }),
            ).toThrow('followerId must be a number');
        });

        it('should throw an error if followerId is null', () => {
            expect(() =>
                AccountFollowedEvent.fromJSON({
                    accountId: 123,
                    followerId: null,
                }),
            ).toThrow('followerId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new AccountFollowedEvent(999, 888);
            const json = original.toJSON();
            const restored = AccountFollowedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
            expect(restored.getFollowerId()).toBe(original.getFollowerId());
        });
    });
});
