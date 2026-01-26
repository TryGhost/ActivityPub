import { describe, expect, it } from 'vitest';

import { DomainBlockedEvent } from '@/account/events/domain-blocked.event';

describe('DomainBlockedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(DomainBlockedEvent.getName()).toBe('domain.blocked');
        });

        it('should return the event name from instance method', () => {
            const domain = new URL('https://example.com');
            const event = new DomainBlockedEvent(domain, 456);

            expect(event.getName()).toBe('domain.blocked');
        });
    });

    describe('getDomain', () => {
        it('should return the domain', () => {
            const domain = new URL('https://example.com');
            const event = new DomainBlockedEvent(domain, 456);

            expect(event.getDomain()).toEqual(domain);
        });
    });

    describe('getBlockerId', () => {
        it('should return the blocker id', () => {
            const domain = new URL('https://example.com');
            const event = new DomainBlockedEvent(domain, 456);

            expect(event.getBlockerId()).toBe(456);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const domain = new URL('https://example.com');
            const event = new DomainBlockedEvent(domain, 456);

            expect(event.toJSON()).toEqual({
                domain: 'https://example.com/',
                blockerId: 456,
            });
        });

        it('should serialize URLs with paths correctly', () => {
            const domain = new URL('https://example.com/path/to/resource');
            const event = new DomainBlockedEvent(domain, 123);

            expect(event.toJSON()).toEqual({
                domain: 'https://example.com/path/to/resource',
                blockerId: 123,
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = DomainBlockedEvent.fromJSON({
                domain: 'https://example.com',
                blockerId: 456,
            });

            expect(event.getDomain().toString()).toBe('https://example.com/');
            expect(event.getBlockerId()).toBe(456);
        });

        it('should throw an error if domain is missing', () => {
            expect(() =>
                DomainBlockedEvent.fromJSON({
                    blockerId: 456,
                }),
            ).toThrow('domain must be a string');
        });

        it('should throw an error if domain is not a string', () => {
            expect(() =>
                DomainBlockedEvent.fromJSON({
                    domain: 123,
                    blockerId: 456,
                }),
            ).toThrow('domain must be a string');
        });

        it('should throw an error if domain is null', () => {
            expect(() =>
                DomainBlockedEvent.fromJSON({
                    domain: null,
                    blockerId: 456,
                }),
            ).toThrow('domain must be a string');
        });

        it('should throw an error if blockerId is missing', () => {
            expect(() =>
                DomainBlockedEvent.fromJSON({
                    domain: 'https://example.com',
                }),
            ).toThrow('blockerId must be a number');
        });

        it('should throw an error if blockerId is not a number', () => {
            expect(() =>
                DomainBlockedEvent.fromJSON({
                    domain: 'https://example.com',
                    blockerId: 'not a number',
                }),
            ).toThrow('blockerId must be a number');
        });

        it('should throw an error if blockerId is null', () => {
            expect(() =>
                DomainBlockedEvent.fromJSON({
                    domain: 'https://example.com',
                    blockerId: null,
                }),
            ).toThrow('blockerId must be a number');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const domain = new URL('https://example.com');
            const original = new DomainBlockedEvent(domain, 888);
            const json = original.toJSON();
            const restored = DomainBlockedEvent.fromJSON(json);

            expect(restored.getDomain().toString()).toBe(
                original.getDomain().toString(),
            );
            expect(restored.getBlockerId()).toBe(original.getBlockerId());
        });

        it('should preserve complex URLs through round-trip', () => {
            const domain = new URL(
                'https://subdomain.example.com:8080/path?query=value#hash',
            );
            const original = new DomainBlockedEvent(domain, 999);
            const json = original.toJSON();
            const restored = DomainBlockedEvent.fromJSON(json);

            expect(restored.getDomain().toString()).toBe(
                original.getDomain().toString(),
            );
        });
    });
});
