import { describe, expect, it } from 'vitest';

import { AccountCreatedEvent } from '@/account/events/account-created.event';

describe('AccountCreatedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(AccountCreatedEvent.getName()).toBe('account.created');
        });

        it('should return the event name from instance method', () => {
            const event = new AccountCreatedEvent(123);

            expect(event.getName()).toBe('account.created');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new AccountCreatedEvent(123);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountCreatedEvent(456);

            expect(event.toJSON()).toEqual({
                accountId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = AccountCreatedEvent.fromJSON({
                accountId: 789,
            });

            expect(event.getAccountId()).toBe(789);
        });

        it('should throw an error if accountId is missing', () => {
            expect(() => AccountCreatedEvent.fromJSON({})).toThrow(
                'accountId must be a number',
            );
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                AccountCreatedEvent.fromJSON({
                    accountId: 'not a number',
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                AccountCreatedEvent.fromJSON({
                    accountId: null,
                }),
            ).toThrow('accountId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new AccountCreatedEvent(999);
            const json = original.toJSON();
            const restored = AccountCreatedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
        });
    });
});
