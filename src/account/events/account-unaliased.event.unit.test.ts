import { describe, expect, it } from 'vitest';

import { AccountUnaliasedEvent } from '@/account/events/account-unaliased.event';

describe('AccountUnaliasedEvent', () => {
    describe('getName', () => {
        it('should return the event name from static method', () => {
            expect(AccountUnaliasedEvent.getName()).toBe('account.unaliased');
        });

        it('should return the event name from instance method', () => {
            const event = new AccountUnaliasedEvent(
                123,
                new URL('https://mastodon.social/users/alice'),
            );

            expect(event.getName()).toBe('account.unaliased');
        });
    });

    describe('getAccountId', () => {
        it('should return the account id', () => {
            const event = new AccountUnaliasedEvent(
                123,
                new URL('https://mastodon.social/users/alice'),
            );

            expect(event.getAccountId()).toBe(123);
        });
    });

    describe('getAliasApId', () => {
        it('should return the alias AP ID', () => {
            const aliasApId = new URL('https://mastodon.social/users/alice');
            const event = new AccountUnaliasedEvent(123, aliasApId);

            expect(event.getAliasApId().href).toBe(aliasApId.href);
        });
    });

    describe('toJSON', () => {
        it('should serialize the event to JSON', () => {
            const event = new AccountUnaliasedEvent(
                123,
                new URL('https://mastodon.social/users/alice'),
            );

            expect(event.toJSON()).toEqual({
                accountId: 123,
                aliasApId: 'https://mastodon.social/users/alice',
            });
        });
    });

    describe('fromJSON', () => {
        it('should deserialize the event from JSON', () => {
            const event = AccountUnaliasedEvent.fromJSON({
                accountId: 123,
                aliasApId: 'https://mastodon.social/users/alice',
            });

            expect(event.getAccountId()).toBe(123);
            expect(event.getAliasApId().href).toBe(
                'https://mastodon.social/users/alice',
            );
        });

        it('should throw an error if accountId is missing', () => {
            expect(() =>
                AccountUnaliasedEvent.fromJSON({
                    aliasApId: 'https://mastodon.social/users/alice',
                }),
            ).toThrow('accountId must be a number');
        });

        it('should throw an error if aliasApId is missing', () => {
            expect(() =>
                AccountUnaliasedEvent.fromJSON({
                    accountId: 123,
                }),
            ).toThrow('aliasApId must be a string');
        });
    });

    describe('round-trip serialization', () => {
        it('should correctly serialize and deserialize', () => {
            const original = new AccountUnaliasedEvent(
                999,
                new URL('https://mastodon.social/users/alice'),
            );
            const json = original.toJSON();
            const restored = AccountUnaliasedEvent.fromJSON(json);

            expect(restored.getAccountId()).toBe(original.getAccountId());
            expect(restored.getAliasApId().href).toBe(
                original.getAliasApId().href,
            );
        });
    });
});
