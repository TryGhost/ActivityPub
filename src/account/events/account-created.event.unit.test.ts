import { describe, expect, it } from 'vitest';

import { AccountCreatedEvent } from '@/account/events/account-created.event';

describe('AccountCreatedEvent', () => {
    it('should return the account ID', () => {
        const event = new AccountCreatedEvent(123);

        expect(event.getAccountId()).toBe(123);
    });

    it('should return the event name via static method', () => {
        expect(AccountCreatedEvent.getName()).toBe('account.created');
    });

    it('should return the event name via instance method', () => {
        const event = new AccountCreatedEvent(123);

        expect(event.getName()).toBe('account.created');
    });

    it('should be serializable', () => {
        const event = new AccountCreatedEvent(456);

        expect(event.toJSON()).toEqual({
            accountId: 456,
        });
    });

    it('should be deserializable', () => {
        const event = AccountCreatedEvent.fromJSON({
            accountId: 789,
        });

        expect(event.getAccountId()).toBe(789);
    });

    it('should throw an error if accountId is not a number', () => {
        expect(() =>
            AccountCreatedEvent.fromJSON({
                accountId: 'not a number',
            }),
        ).toThrow('accountId must be a number');
    });

    it('should throw an error if accountId is missing', () => {
        expect(() => AccountCreatedEvent.fromJSON({})).toThrow(
            'accountId must be a number',
        );
    });

    it('should support round-trip serialization/deserialization', () => {
        const original = new AccountCreatedEvent(42);
        const serialized = original.toJSON();
        const deserialized = AccountCreatedEvent.fromJSON(serialized);

        expect(deserialized.getAccountId()).toBe(original.getAccountId());
    });
});
