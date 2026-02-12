import { describe, expect, it } from 'vitest';

import { AccountUpdatedEvent } from '@/account/events/account-updated.event';

describe('AccountUpdatedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(AccountUpdatedEvent.getName()).toBe('account.updated');
        });

        it('should return the event name from instance method', () => {
            const event = new AccountUpdatedEvent(123);

            expect(event.getName()).toBe('account.updated');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new AccountUpdatedEvent(123);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountUpdatedEvent(456);

            expect(event.toJSON()).toEqual({
                accountId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = AccountUpdatedEvent.fromJSON({
                accountId: 789,
            });

            expect(event.getAccountId()).toBe(789);
        });

        it('should throw an error if accountId is missing', () => {
            expect(() => AccountUpdatedEvent.fromJSON({})).toThrow(
                'accountId must be a number',
            );
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                AccountUpdatedEvent.fromJSON({
                    accountId: 'not a number',
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                AccountUpdatedEvent.fromJSON({
                    accountId: null,
                }),
            ).toThrow('accountId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new AccountUpdatedEvent(999);
            const json = original.toJSON();
            const restored = AccountUpdatedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
        });
    });
});
