import { describe, expect, it } from 'vitest';

import { AccountUpdatedEvent } from '@/account/events/account-updated.event';

describe('AccountUpdatedEvent', () => {
    it('should be serializable', () => {
        const event = new AccountUpdatedEvent(123);

        expect(event.toJSON()).toEqual({
            accountId: 123,
        });
    });

    it('should be deserializable', () => {
        const event = AccountUpdatedEvent.fromJSON({
            accountId: 456,
        });

        expect(event.getAccountId()).toBe(456);
    });

    it('should throw an error if accountId is not a number', () => {
        expect(() =>
            AccountUpdatedEvent.fromJSON({
                accountId: 'not a number',
            }),
        ).toThrow('accountId must be a number');
    });

    it('should throw an error if accountId is missing', () => {
        expect(() => AccountUpdatedEvent.fromJSON({})).toThrow(
            'accountId must be a number',
        );
    });

    it('should return correct name from static method', () => {
        expect(AccountUpdatedEvent.getName()).toBe('account.updated');
    });

    it('should return correct name from instance method', () => {
        const event = new AccountUpdatedEvent(123);
        expect(event.getName()).toBe('account.updated');
    });
});
