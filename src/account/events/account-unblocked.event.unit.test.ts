import { describe, expect, it } from 'vitest';

import { AccountUnblockedEvent } from '@/account/events/account-unblocked.event';

describe('AccountUnblockedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(AccountUnblockedEvent.getName()).toBe('account.unblocked');
        });

        it('should return the event name from instance method', () => {
            const event = new AccountUnblockedEvent(123, 456);

            expect(event.getName()).toBe('account.unblocked');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new AccountUnblockedEvent(123, 456);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('getUnblockerId', () => {
        it('should return the unblocker id', () => {
            const event = new AccountUnblockedEvent(123, 456);

            expect(event.getUnblockerId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountUnblockedEvent(123, 456);

            expect(event.toJSON()).toEqual({
                accountId: 123,
                unblockerId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = AccountUnblockedEvent.fromJSON({
                accountId: 123,
                unblockerId: 456,
            });

            expect(event.getAccountId()).toBe(123);
            expect(event.getUnblockerId()).toBe(456);
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                AccountUnblockedEvent.fromJSON({
                    unblockerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                AccountUnblockedEvent.fromJSON({
                    accountId: 'not a number',
                    unblockerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                AccountUnblockedEvent.fromJSON({
                    accountId: null,
                    unblockerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if unblockerId is missing', () => {
            expect(() =>
                AccountUnblockedEvent.fromJSON({
                    accountId: 123,
                }),
            ).toThrow('unblockerId must be a number');
        });

        it('should throw an error if unblockerId is not a number', () => {
            expect(() =>
                AccountUnblockedEvent.fromJSON({
                    accountId: 123,
                    unblockerId: 'not a number',
                }),
            ).toThrow('unblockerId must be a number');
        });

        it('should throw an error if unblockerId is null', () => {
            expect(() =>
                AccountUnblockedEvent.fromJSON({
                    accountId: 123,
                    unblockerId: null,
                }),
            ).toThrow('unblockerId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new AccountUnblockedEvent(999, 888);
            const json = original.toJSON();
            const restored = AccountUnblockedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
            expect(restored.getUnblockerId()).toBe(original.getUnblockerId());
        });
    });
});
