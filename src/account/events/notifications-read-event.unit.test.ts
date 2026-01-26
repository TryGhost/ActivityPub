import { describe, expect, it } from 'vitest';

import { NotificationsReadEvent } from '@/account/events/notifications-read-event';

describe('NotificationsReadEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(NotificationsReadEvent.getName()).toBe('notifications.read');
        });

        it('should return the event name from instance method', () => {
            const event = new NotificationsReadEvent(123);

            expect(event.getName()).toBe('notifications.read');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new NotificationsReadEvent(123);

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new NotificationsReadEvent(456);

            expect(event.toJSON()).toEqual({
                accountId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = NotificationsReadEvent.fromJSON({
                accountId: 789,
            });

            expect(event.getAccountId()).toBe(789);
        });

        it('should throw an error if accountId is missing', () => {
            expect(() => NotificationsReadEvent.fromJSON({})).toThrow(
                'accountId must be a number',
            );
        });

        it('should throw an error if accountId is not a number', () => {
            expect(() =>
                NotificationsReadEvent.fromJSON({
                    accountId: 'not a number',
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if accountId is null', () => {
            expect(() =>
                NotificationsReadEvent.fromJSON({
                    accountId: null,
                }),
            ).toThrow('accountId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new NotificationsReadEvent(999);
            const json = original.toJSON();
            const restored = NotificationsReadEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
        });
    });
});
