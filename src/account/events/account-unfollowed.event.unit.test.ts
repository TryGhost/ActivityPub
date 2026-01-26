import { describe, expect, it } from 'vitest';

import { AccountUnfollowedEvent } from '@/account/events/account-unfollowed.event';

describe('AccountUnfollowedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(AccountUnfollowedEvent.getName()).toBe('account.unfollowed');
        });

        it('should return the event name from instance method', () => {
            const event = new AccountUnfollowedEvent(123, 456);

            expect(event.getName()).toBe('account.unfollowed');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new AccountUnfollowedEvent(123, 456);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('getUnfollowerId', () => {
        it('should return the unfollower id', () => {
            const event = new AccountUnfollowedEvent(123, 456);

            expect(event.getUnfollowerId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountUnfollowedEvent(123, 456);

            expect(event.toJSON()).toEqual({
                accountId: 123,
                unfollowerId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = AccountUnfollowedEvent.fromJSON({
                accountId: 123,
                unfollowerId: 456,
            });

            expect(event.getAccountId()).toBe(123);
            expect(event.getUnfollowerId()).toBe(456);
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                AccountUnfollowedEvent.fromJSON({
                    unfollowerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                AccountUnfollowedEvent.fromJSON({
                    accountId: 'not a number',
                    unfollowerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                AccountUnfollowedEvent.fromJSON({
                    accountId: null,
                    unfollowerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if unfollowerId is missing', () => {
            expect(() =>
                AccountUnfollowedEvent.fromJSON({
                    accountId: 123,
                }),
            ).toThrow('unfollowerId must be a number');
        });

        it('should throw an error if unfollowerId is not a number', () => {
            expect(() =>
                AccountUnfollowedEvent.fromJSON({
                    accountId: 123,
                    unfollowerId: 'not a number',
                }),
            ).toThrow('unfollowerId must be a number');
        });

        it('should throw an error if unfollowerId is null', () => {
            expect(() =>
                AccountUnfollowedEvent.fromJSON({
                    accountId: 123,
                    unfollowerId: null,
                }),
            ).toThrow('unfollowerId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new AccountUnfollowedEvent(999, 888);
            const json = original.toJSON();
            const restored = AccountUnfollowedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
            expect(restored.getUnfollowerId()).toBe(original.getUnfollowerId());
        });
    });
});
