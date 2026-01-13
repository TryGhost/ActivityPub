import { describe, expect, it } from 'vitest';

import { EventSerializer } from '@/events/event';
import { AccountCreatedEvent } from './account-created.event';

describe('AccountCreatedEvent', () => {
    describe('constructor and getAccountId', () => {
        it('should create an event with the given accountId', () => {
            const event = new AccountCreatedEvent(123);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('getName', () => {
        it('should return the event name from the instance method', () => {
            const event = new AccountCreatedEvent(123);

            expect(event.getName()).toBe('account.created');
        });

        it('should return the event name from the static method', () => {
            expect(AccountCreatedEvent.getName()).toBe('account.created');
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountCreatedEvent(456);

            const json = event.toJSON();

            expect(json).toEqual({ accountId: 456 });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize an event from JSON', () => {
            const event = AccountCreatedEvent.fromJSON({ accountId: 789 });

            expect(event.getAccountId()).toBe(789);
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                AccountCreatedEvent.fromJSON({ accountId: '123' }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is missing', () => {
            expect(() => AccountCreatedEvent.fromJSON({})).toThrow(
                'accountId must be a number',
            );
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                AccountCreatedEvent.fromJSON({ accountId: null }),
            ).toThrow('accountId must be a number');
        });
    });

    describe('serialization round-trip', () => {
        it('should serialize and deserialize correctly', () => {
            const original = new AccountCreatedEvent(999);

            const json = original.toJSON();
            const restored = AccountCreatedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
        });

        it('should work with EventSerializer', () => {
            const serializer = new EventSerializer();
            serializer.register(
                AccountCreatedEvent.getName(),
                AccountCreatedEvent,
            );

            const original = new AccountCreatedEvent(1234);

            const serialized = serializer.serialize(original);
            const deserialized = serializer.deserialize(
                AccountCreatedEvent.getName(),
                serialized,
            );

            expect(deserialized).toEqual(original);
        });
    });
});
