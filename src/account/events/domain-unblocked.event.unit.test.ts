import { describe, expect, it } from 'vitest';

import { DomainUnblockedEvent } from '@/account/events/domain-unblocked.event';

describe('DomainUnblockedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(DomainUnblockedEvent.getName()).toBe('domain.unblocked');
        });

        it('should return the event name from instance method', () => {
            const domain = new URL('https://example.com');
            const event = new DomainUnblockedEvent(domain, 456);

            expect(event.getName()).toBe('domain.unblocked');
        });
    });

    describe('getDomain', () => {
        it('should return the domain', () => {
            const domain = new URL('https://example.com');
            const event = new DomainUnblockedEvent(domain, 456);

            expect(event.getDomain()).toEqual(domain);
        });
    });

    describe('getUnblockerId', () => {
        it('should return the unblocker id', () => {
            const domain = new URL('https://example.com');
            const event = new DomainUnblockedEvent(domain, 456);

            expect(event.getUnblockerId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const domain = new URL('https://example.com');
            const event = new DomainUnblockedEvent(domain, 456);

            expect(event.toJSON()).toEqual({
                domain: 'https://example.com/',
                unblockerId: 456,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = DomainUnblockedEvent.fromJSON({
                domain: 'https://example.com',
                unblockerId: 456,
            });

            expect(event.getDomain().toString()).toBe('https://example.com/');
            expect(event.getUnblockerId()).toBe(456);
        });

        it('should throw an error if domain is missing', () => {
            expect(() =>
                DomainUnblockedEvent.fromJSON({
                    unblockerId: 456,
                }),
            ).toThrow('domain must be a string');
        });

        it('should throw an error if domain is not a string', () => {
            expect(() =>
                DomainUnblockedEvent.fromJSON({
                    domain: 123,
                    unblockerId: 456,
                }),
            ).toThrow('domain must be a string');
        });

        it('should throw an error if domain is null', () => {
            expect(() =>
                DomainUnblockedEvent.fromJSON({
                    domain: null,
                    unblockerId: 456,
                }),
            ).toThrow('domain must be a string');
        });

        it('should throw an error if unblockerId is missing', () => {
            expect(() =>
                DomainUnblockedEvent.fromJSON({
                    domain: 'https://example.com',
                }),
            ).toThrow('unblockerId must be a number');
        });

        it('should throw an error if unblockerId is not a number', () => {
            expect(() =>
                DomainUnblockedEvent.fromJSON({
                    domain: 'https://example.com',
                    unblockerId: 'not a number',
                }),
            ).toThrow('unblockerId must be a number');
        });

        it('should throw an error if unblockerId is null', () => {
            expect(() =>
                DomainUnblockedEvent.fromJSON({
                    domain: 'https://example.com',
                    unblockerId: null,
                }),
            ).toThrow('unblockerId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const domain = new URL('https://example.com');
            const original = new DomainUnblockedEvent(domain, 888);
            const json = original.toJSON();
            const restored = DomainUnblockedEvent.fromJSON(json);

            expect(restored.getDomain().toString()).toBe(
                original.getDomain().toString(),
            );
            expect(restored.getUnblockerId()).toBe(original.getUnblockerId());
        });

        it('should preserve URL path and other components', () => {
            const domain = new URL('https://subdomain.example.com:8080/path');
            const original = new DomainUnblockedEvent(domain, 999);
            const json = original.toJSON();
            const restored = DomainUnblockedEvent.fromJSON(json);

            expect(restored.getDomain().toString()).toBe(
                original.getDomain().toString(),
            );
            expect(restored.getDomain().hostname).toBe('subdomain.example.com');
            expect(restored.getDomain().port).toBe('8080');
            expect(restored.getDomain().pathname).toBe('/path');
        });
    });
});
