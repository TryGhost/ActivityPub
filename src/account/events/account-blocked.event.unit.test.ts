import { describe, expect, it } from 'vitest';

import { AccountBlockedEvent } from '@/account/events/account-blocked.event';

describe('AccountBlockedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(AccountBlockedEvent.getName()).toBe('account.blocked');
        });

        it('should return the event name from instance method', () => {
            const event = new AccountBlockedEvent(123, 456);

            expect(event.getName()).toBe('account.blocked');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new AccountBlockedEvent(123, 456);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('getBlockerId', () => {
        it('should return the blocker id', () => {
            const event = new AccountBlockedEvent(123, 456);

            expect(event.getBlockerId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountBlockedEvent(123, 456);

            expect(event.toJSON()).toEqual({
                accountId: 123,
                blockerId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = AccountBlockedEvent.fromJSON({
                accountId: 123,
                blockerId: 456,
            });

            expect(event.getAccountId()).toBe(123);
            expect(event.getBlockerId()).toBe(456);
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                AccountBlockedEvent.fromJSON({
                    blockerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                AccountBlockedEvent.fromJSON({
                    accountId: 'not a number',
                    blockerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                AccountBlockedEvent.fromJSON({
                    accountId: null,
                    blockerId: 456,
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if blockerId is missing', () => {
            expect(() =>
                AccountBlockedEvent.fromJSON({
                    accountId: 123,
                }),
            ).toThrow('blockerId must be a number');
        });

        it('should throw an error if blockerId is not a number', () => {
            expect(() =>
                AccountBlockedEvent.fromJSON({
                    accountId: 123,
                    blockerId: 'not a number',
                }),
            ).toThrow('blockerId must be a number');
        });

        it('should throw an error if blockerId is null', () => {
            expect(() =>
                AccountBlockedEvent.fromJSON({
                    accountId: 123,
                    blockerId: null,
                }),
            ).toThrow('blockerId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new AccountBlockedEvent(999, 888);
            const json = original.toJSON();
            const restored = AccountBlockedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
            expect(restored.getBlockerId()).toBe(original.getBlockerId());
        });
    });
});
