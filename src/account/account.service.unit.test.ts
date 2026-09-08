import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isActor } from '@fedify/vocab';
import type { Knex } from 'knex';

import type { AccountEntity } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { AsyncEvents } from '@/core/events';
import { error, ok } from '@/core/result';
import * as lookupHelpers from '@/lookup-helpers';

vi.mock('@fedify/vocab', async () => {
    const original = await vi.importActual('@fedify/vocab');

    return {
        ...original,
        isActor: vi.fn(),
    };
});

vi.mock('@/lookup-helpers', () => ({
    lookupActorProfile: vi.fn(),
    lookupObject: vi.fn(),
    resolveCustomWebfingerHost: vi.fn().mockResolvedValue({
        type: 'unavailable',
    }),
}));

describe('AccountService', () => {
    let knex: Knex;
    let asyncEvents: AsyncEvents;
    let knexAccountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let generateKeyPair: () => Promise<CryptoKeyPair>;
    let accountService: AccountService;
    let fedifyContext: object;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();

        knex = {} as Knex;
        asyncEvents = {} as AsyncEvents;
        knexAccountRepository = {
            save: vi.fn(),
            getById: vi.fn(),
            getByApId: vi.fn(),
            getByInboxUrl: vi.fn(),
            hasWebfingerHandleConflict: vi.fn().mockResolvedValue(false),
            updateWebfingerHost: vi.fn(),
        } as unknown as KnexAccountRepository;
        fedifyContext = {};
        fedifyContextFactory = {
            getFedifyContext: vi.fn().mockReturnValue(fedifyContext),
        } as unknown as FedifyContextFactory;
        generateKeyPair = vi.fn();

        accountService = new AccountService(
            knex,
            asyncEvents,
            knexAccountRepository,
            fedifyContextFactory,
            generateKeyPair,
        );
    });

    describe('validateWebfingerHost', () => {
        const account = {
            id: 1,
            username: 'index',
            apId: new URL('https://blog.example.com/users/index'),
        } as AccountEntity;

        it('validates live WebFinger data for the account', async () => {
            const fetchMock = vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        subject: 'acct:index@example.com',
                        links: [
                            {
                                rel: 'self',
                                type: 'application/activity+json',
                                href: 'https://blog.example.com/users/index',
                            },
                        ],
                    }),
                    {
                        status: 200,
                        headers: {
                            'content-type': 'application/jrd+json',
                        },
                    },
                ),
            );
            vi.stubGlobal('fetch', fetchMock);

            const result = await accountService.validateWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(ok(true));
            expect(fetchMock).toHaveBeenCalledWith(
                new URL(
                    'https://example.com/.well-known/webfinger?resource=acct%3Aindex%40example.com',
                ),
                expect.objectContaining({
                    redirect: 'follow',
                }),
            );
        });

        it('rejects invalid domains', async () => {
            const result = await accountService.validateWebfingerHost(
                account,
                'https://example.com',
            );

            expect(result).toEqual(
                error({
                    type: 'invalid-domain',
                    host: 'https://example.com',
                }),
            );
        });

        it('rejects conflicting handles', async () => {
            vi.mocked(
                knexAccountRepository.hasWebfingerHandleConflict,
            ).mockResolvedValue(true);

            const result = await accountService.validateWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(
                error({ type: 'conflict', host: 'example.com' }),
            );
        });

        it('rejects unreachable domains', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no')));

            const result = await accountService.validateWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(
                error({ type: 'not-reachable', host: 'example.com' }),
            );
        });

        it('rejects non-json WebFinger responses', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(
                    new Response('nope', {
                        status: 200,
                        headers: { 'content-type': 'text/plain' },
                    }),
                ),
            );

            const result = await accountService.validateWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(
                error({ type: 'invalid-webfinger', host: 'example.com' }),
            );
        });

        it('rejects WebFinger responses without a self link', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(
                    new Response(
                        JSON.stringify({
                            subject: 'acct:index@example.com',
                            links: [],
                        }),
                        {
                            status: 200,
                            headers: {
                                'content-type': 'application/jrd+json',
                            },
                        },
                    ),
                ),
            );

            const result = await accountService.validateWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(
                error({ type: 'invalid-webfinger', host: 'example.com' }),
            );
        });

        it('rejects WebFinger responses for the wrong actor', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(
                    new Response(
                        JSON.stringify({
                            subject: 'acct:index@example.com',
                            links: [
                                {
                                    rel: 'self',
                                    type: 'application/activity+json',
                                    href: 'https://other.example.com/users/index',
                                },
                            ],
                        }),
                        {
                            status: 200,
                            headers: {
                                'content-type': 'application/jrd+json',
                            },
                        },
                    ),
                ),
            );

            const result = await accountService.validateWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(
                error({
                    type: 'wrong-actor',
                    host: 'example.com',
                    expectedActorUrl: 'https://blog.example.com/users/index',
                    actualActorUrl: 'https://other.example.com/users/index',
                }),
            );
        });

        it('rejects WebFinger responses for the wrong subject', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(
                    new Response(
                        JSON.stringify({
                            subject: 'acct:index@other.example.com',
                            links: [
                                {
                                    rel: 'self',
                                    type: 'application/activity+json',
                                    href: 'https://blog.example.com/users/index',
                                },
                            ],
                        }),
                        {
                            status: 200,
                            headers: {
                                'content-type': 'application/jrd+json',
                            },
                        },
                    ),
                ),
            );

            const result = await accountService.validateWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(
                error({ type: 'invalid-webfinger', host: 'example.com' }),
            );
        });
    });

    describe('setWebfingerHost', () => {
        it('saves a validated custom domain', async () => {
            const updatedAccount = {
                id: 1,
                webfingerHost: 'example.com',
            } as AccountEntity;
            const account = {
                id: 1,
                username: 'index',
                apId: new URL('https://blog.example.com/users/index'),
                setWebfingerHost: vi.fn().mockReturnValue(updatedAccount),
            } as unknown as AccountEntity;

            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(
                    new Response(
                        JSON.stringify({
                            subject: 'acct:index@example.com',
                            links: [
                                {
                                    rel: 'self',
                                    type: 'application/activity+json',
                                    href: 'https://blog.example.com/users/index',
                                },
                            ],
                        }),
                        {
                            status: 200,
                            headers: {
                                'content-type': 'application/jrd+json',
                            },
                        },
                    ),
                ),
            );

            const result = await accountService.setWebfingerHost(
                account,
                'example.com',
            );

            expect(result).toEqual(ok(updatedAccount));
            expect(account.setWebfingerHost).toHaveBeenCalledWith(
                'example.com',
            );
            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(1, 'example.com');
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
            // Host must be queryable via WebFinger before AccountUpdatedEvent
            // federates an Update to peers
            expect(
                vi.mocked(knexAccountRepository.updateWebfingerHost).mock
                    .invocationCallOrder[0],
            ).toBeLessThan(
                vi.mocked(knexAccountRepository.save).mock
                    .invocationCallOrder[0],
            );
        });

        it('clears the custom domain without live validation', async () => {
            const updatedAccount = {
                id: 1,
                webfingerHost: null,
            } as AccountEntity;
            const account = {
                id: 1,
                apId: new URL('https://blog.example.com/users/index'),
                setWebfingerHost: vi.fn().mockReturnValue(updatedAccount),
            } as unknown as AccountEntity;
            const fetchMock = vi.fn();
            vi.stubGlobal('fetch', fetchMock);

            const result = await accountService.setWebfingerHost(account, null);

            expect(result).toEqual(ok(updatedAccount));
            expect(fetchMock).not.toHaveBeenCalled();
            expect(account.setWebfingerHost).toHaveBeenCalledWith(null);
            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(1, null);
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
            expect(
                vi.mocked(knexAccountRepository.updateWebfingerHost).mock
                    .invocationCallOrder[0],
            ).toBeLessThan(
                vi.mocked(knexAccountRepository.save).mock
                    .invocationCallOrder[0],
            );
        });
    });

    describe('addAlias', () => {
        it('resolves a handle, verifies the actor, and saves the alias', async () => {
            const updatedAccount = {} as AccountEntity;
            const account = {
                id: 1,
                apId: new URL('https://example.com/users/index'),
                addAlias: vi.fn().mockReturnValue(updatedAccount),
            } as unknown as AccountEntity;
            const sourceApId = new URL('https://mastodon.social/users/old');
            const actor = {
                id: sourceApId,
            };

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(sourceApId),
            );
            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                actor as never,
            );
            vi.mocked(isActor).mockReturnValue(true);

            const result = await accountService.addAlias(
                account,
                '@old@mastodon.social',
            );

            expect(result).toEqual(ok(sourceApId));
            expect(lookupHelpers.lookupActorProfile).toHaveBeenCalledWith(
                fedifyContext,
                '@old@mastodon.social',
            );
            expect(lookupHelpers.lookupObject).toHaveBeenCalledWith(
                fedifyContext,
                sourceApId,
            );
            expect(account.addAlias).toHaveBeenCalledWith(sourceApId);
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });

        it('rejects invalid handles', async () => {
            const account = {
                apId: new URL('https://example.com/users/index'),
            } as AccountEntity;

            const result = await accountService.addAlias(
                account,
                'not-a-handle',
            );

            expect(result).toEqual(error('invalid-handle'));
            expect(lookupHelpers.lookupActorProfile).not.toHaveBeenCalled();
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });

        it('rejects failed WebFinger lookups', async () => {
            const account = {
                apId: new URL('https://example.com/users/index'),
            } as AccountEntity;

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                error('lookup-error'),
            );

            const result = await accountService.addAlias(
                account,
                '@old@mastodon.social',
            );

            expect(result).toEqual(error('lookup-failed'));
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });

        it('rejects failed actor fetches', async () => {
            const account = {
                apId: new URL('https://example.com/users/index'),
            } as AccountEntity;
            const sourceApId = new URL('https://mastodon.social/users/old');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(sourceApId),
            );
            vi.mocked(lookupHelpers.lookupObject).mockRejectedValue(
                new Error('network failed'),
            );

            const result = await accountService.addAlias(
                account,
                '@old@mastodon.social',
            );

            expect(result).toEqual(error('lookup-failed'));
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });

        it('rejects non-actor lookup results', async () => {
            const account = {
                apId: new URL('https://example.com/users/index'),
            } as AccountEntity;
            const sourceApId = new URL('https://mastodon.social/users/old');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(sourceApId),
            );
            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                {} as never,
            );
            vi.mocked(isActor).mockReturnValue(false);

            const result = await accountService.addAlias(
                account,
                '@old@mastodon.social',
            );

            expect(result).toEqual(error('not-an-actor'));
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });

        it('rejects actors without a canonical id', async () => {
            const account = {
                apId: new URL('https://example.com/users/index'),
            } as AccountEntity;
            const sourceApId = new URL('https://mastodon.social/users/old');

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(sourceApId),
            );
            vi.mocked(lookupHelpers.lookupObject).mockResolvedValue(
                {} as never,
            );
            vi.mocked(isActor).mockReturnValue(true);

            const result = await accountService.addAlias(
                account,
                '@old@mastodon.social',
            );

            expect(result).toEqual(error('not-an-actor'));
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });

        it('rejects self aliases', async () => {
            const apId = new URL('https://example.com/users/index');
            const account = {
                apId,
            } as AccountEntity;

            vi.mocked(lookupHelpers.lookupActorProfile).mockResolvedValue(
                ok(apId),
            );

            const result = await accountService.addAlias(
                account,
                '@index@example.com',
            );

            expect(result).toEqual(error('self-alias'));
            expect(lookupHelpers.lookupObject).not.toHaveBeenCalled();
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('removeAlias', () => {
        it('removes an alias and saves the account', async () => {
            const updatedAccount = {} as AccountEntity;
            const account = {
                removeAlias: vi.fn().mockReturnValue(updatedAccount),
            } as unknown as AccountEntity;

            const result = await accountService.removeAlias(
                account,
                'https://mastodon.social/users/old',
            );

            expect(result).toEqual(ok(true));
            expect(account.removeAlias).toHaveBeenCalledWith(
                new URL('https://mastodon.social/users/old'),
            );
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });

        it('rejects invalid actor URIs', async () => {
            const account = {
                removeAlias: vi.fn(),
            } as unknown as AccountEntity;

            const result = await accountService.removeAlias(account, 'not-url');

            expect(result).toEqual(error('invalid-actor-uri'));
            expect(account.removeAlias).not.toHaveBeenCalled();
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('updateAccountProfile', () => {
        it('should update the account profile with the provided data', async () => {
            const updated = {} as unknown as AccountEntity;
            const account = {
                updateProfile: vi.fn().mockReturnValue(updated),
            } as unknown as AccountEntity;
            const data = {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: 'https://example.com/avatar/alice.png',
                bannerImageUrl: 'https://example.com/banner/alice.png',
            };

            await accountService.updateAccountProfile(account, data);

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: data.name,
                bio: data.bio,
                username: data.username,
                avatarUrl: new URL(data.avatarUrl),
                bannerImageUrl: new URL(data.bannerImageUrl),
            });

            expect(knexAccountRepository.save).toHaveBeenCalledWith(updated);
        });

        it('should handle empty values for avatarUrl and bannerImageUrl', async () => {
            const account = {
                updateProfile: vi.fn(),
            } as unknown as AccountEntity;

            await accountService.updateAccountProfile(account, {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: '',
                bannerImageUrl: '',
            });

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: null,
                bannerImageUrl: null,
            });
        });
    });

    describe('updateAccountByApId', () => {
        it('should update the account with the provided data', async () => {
            const updated = {
                isInternal: true,
                username: 'alice',
            } as unknown as AccountEntity;
            const account = {
                isInternal: true,
                username: 'alice',
                updateProfile: vi.fn().mockReturnValue(updated),
            } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getByApId).mockImplementation(() =>
                Promise.resolve(account),
            );

            const data = {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: 'https://example.com/avatar/alice.png',
                bannerImageUrl: 'https://example.com/banner/alice.png',
                url: 'https://example.com/url/alice',
                customFields: {
                    foo: 'bar',
                },
            };

            await accountService.updateAccountByApId(account.apId, data);

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: data.name,
                bio: data.bio,
                username: data.username,
                avatarUrl: new URL(data.avatarUrl),
                bannerImageUrl: new URL(data.bannerImageUrl),
                url: new URL(data.url),
                customFields: data.customFields,
            });

            expect(knexAccountRepository.save).toHaveBeenCalledWith(updated);
        });

        it('should handle empty values for avatarUrl, bannerImageUrl, url, and customFields', async () => {
            const account = {
                isInternal: true,
                username: 'alice',
                updateProfile: vi.fn().mockReturnValue({
                    isInternal: true,
                    username: 'alice',
                }),
            } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getByApId).mockImplementation(() =>
                Promise.resolve(account),
            );

            await accountService.updateAccountByApId(account.apId, {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: '',
                bannerImageUrl: '',
                url: '',
                customFields: null,
            });

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: null,
                bannerImageUrl: null,
                url: null,
                customFields: null,
            });
        });

        it('refreshes webfinger host for external accounts after profile update', async () => {
            const afterProfile = {
                isInternal: false,
                webfingerHost: null,
                username: 'alice',
                apId: new URL('https://blog.example.com/users/alice'),
                id: 9,
            } as unknown as AccountEntity;
            const account = {
                isInternal: false,
                username: 'alice',
                updateProfile: vi.fn().mockReturnValue(afterProfile),
            } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getByApId).mockResolvedValue(
                account,
            );
            vi.mocked(
                knexAccountRepository.hasWebfingerHandleConflict,
            ).mockResolvedValue(false);
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({
                type: 'custom',
                host: 'custom.example',
            });

            await accountService.updateAccountByApId(
                new URL('https://blog.example.com/users/alice'),
                {
                    name: 'Alice',
                    bio: 'bio',
                    username: 'alice',
                    avatarUrl: '',
                    bannerImageUrl: '',
                    url: '',
                    customFields: null,
                },
            );

            expect(
                lookupHelpers.resolveCustomWebfingerHost,
            ).toHaveBeenCalledWith('alice', afterProfile.apId);
            // Only the host column is written, so a concurrent profile update
            // cannot be clobbered by this stale entity
            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(9, 'custom.example');
        });

        it('clears a stored host when username changes and WebFinger is unavailable', async () => {
            const afterProfile = {
                isInternal: false,
                webfingerHost: null,
                username: 'alice',
                apId: new URL('https://blog.example.com/users/bob'),
                id: 9,
            } as unknown as AccountEntity;
            const afterClear = {
                isInternal: false,
                webfingerHost: null,
                username: 'bob',
                apId: new URL('https://blog.example.com/users/bob'),
                id: 9,
                updateProfile: vi.fn().mockReturnValue(afterProfile),
            } as unknown as AccountEntity;
            const account = {
                isInternal: false,
                username: 'bob',
                webfingerHost: 'custom.example',
                id: 9,
                setWebfingerHost: vi.fn().mockReturnValue(afterClear),
            } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getByApId).mockResolvedValue(
                account,
            );
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'unavailable' });

            await accountService.updateAccountByApId(
                new URL('https://blog.example.com/users/bob'),
                {
                    name: 'Alice',
                    bio: 'bio',
                    username: 'alice',
                    avatarUrl: '',
                    bannerImageUrl: '',
                    url: '',
                    customFields: null,
                },
            );

            // Host cleared before the username write — never (alice, custom.example)
            expect(account.setWebfingerHost).toHaveBeenCalledWith(null);
            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(9, null);
            expect(
                vi.mocked(knexAccountRepository.updateWebfingerHost).mock
                    .invocationCallOrder[0],
            ).toBeLessThan(
                vi.mocked(knexAccountRepository.save).mock
                    .invocationCallOrder[0],
            );
        });
    });

    describe('refreshExternalWebfingerHost', () => {
        const externalAccount = (
            overrides: Partial<Record<string, unknown>> = {},
        ) =>
            ({
                isInternal: false,
                id: 1,
                username: 'john',
                apId: new URL(
                    'https://john.onolan.org/.ghost/activitypub/users/index',
                ),
                webfingerHost: null,
                ...overrides,
            }) as unknown as AccountEntity;

        it('persists a verified custom host', async () => {
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'custom', host: 'onolan.org' });

            await accountService.refreshExternalWebfingerHost(
                externalAccount(),
            );

            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(1, 'onolan.org');
        });

        it('never writes the actor host, so null keeps meaning "use the actor host"', async () => {
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'none' });

            await accountService.refreshExternalWebfingerHost(
                externalAccount(),
            );

            expect(
                knexAccountRepository.updateWebfingerHost,
            ).not.toHaveBeenCalled();
        });

        it('clears a stored host once the custom handle stops resolving', async () => {
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'none' });

            await accountService.refreshExternalWebfingerHost(
                externalAccount({ webfingerHost: 'onolan.org' }),
            );

            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(1, null);
        });

        it('leaves a stored host alone when the lookup is unavailable', async () => {
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'unavailable' });

            await accountService.refreshExternalWebfingerHost(
                externalAccount({ webfingerHost: 'onolan.org' }),
            );

            expect(
                knexAccountRepository.updateWebfingerHost,
            ).not.toHaveBeenCalled();
        });

        it('clears a stored host when the username changed and lookup is unavailable', async () => {
            // A host verified for @bob@custom must not survive a rename to
            // alice when we cannot re-verify — otherwise we display an
            // unverified handle
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'unavailable' });

            await accountService.refreshExternalWebfingerHost(
                externalAccount({
                    username: 'alice',
                    webfingerHost: 'custom.example',
                }),
                { usernameChanged: true },
            );

            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(1, null);
        });

        it('clears a stored host when username changed but the new host conflicts', async () => {
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'custom', host: 'custom.example' });
            vi.mocked(
                knexAccountRepository.hasWebfingerHandleConflict,
            ).mockResolvedValue(true);

            await accountService.refreshExternalWebfingerHost(
                externalAccount({
                    username: 'alice',
                    webfingerHost: 'old-custom.example',
                }),
                { usernameChanged: true },
            );

            expect(
                knexAccountRepository.updateWebfingerHost,
            ).toHaveBeenCalledWith(1, null);
        });

        it('does not take a handle already held by another account', async () => {
            vi.mocked(
                lookupHelpers.resolveCustomWebfingerHost,
            ).mockResolvedValue({ type: 'custom', host: 'onolan.org' });
            vi.mocked(
                knexAccountRepository.hasWebfingerHandleConflict,
            ).mockResolvedValue(true);

            await accountService.refreshExternalWebfingerHost(
                externalAccount(),
            );

            expect(
                knexAccountRepository.updateWebfingerHost,
            ).not.toHaveBeenCalled();
        });

        it('ignores internal accounts, whose host is set by the site owner', async () => {
            await accountService.refreshExternalWebfingerHost(
                externalAccount({ isInternal: true }),
            );

            expect(
                lookupHelpers.resolveCustomWebfingerHost,
            ).not.toHaveBeenCalled();
        });
    });

    describe('ensureByApId', () => {
        it('does not hit the network for an account already in the database', async () => {
            const account = {
                isInternal: false,
                webfingerHost: null,
                apId: new URL(
                    'https://john.onolan.org/.ghost/activitypub/users/index',
                ),
            } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getByApId).mockResolvedValue(
                account,
            );

            const result = await accountService.ensureByApId(account.apId);

            expect(result).toEqual(ok(account));
            expect(
                lookupHelpers.resolveCustomWebfingerHost,
            ).not.toHaveBeenCalled();
            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('getAccountById', () => {
        it('should return the result from the account repository', async () => {
            const accountId = 1;
            const account = { id: accountId } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getById).mockImplementation(
                (_id) => {
                    if (_id === accountId) {
                        return Promise.resolve(account);
                    }

                    return Promise.resolve(null);
                },
            );

            const result = await accountService.getAccountById(accountId);

            expect(result).toBe(account);
        });
    });

    describe('followAccount', () => {
        it('should follow an account', async () => {
            const account = {
                id: 1,
                follow: vi.fn(),
            } as unknown as AccountEntity;
            const accountToFollow = { id: 2 } as unknown as AccountEntity;
            const updatedAccount = {
                id: 1,
            } as unknown as AccountEntity;

            vi.mocked(account.follow).mockImplementation(() => updatedAccount);

            await accountService.followAccount(account, accountToFollow);

            expect(account.follow).toHaveBeenCalledWith(accountToFollow);
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });
    });

    describe('unfollowAccount', () => {
        it('should unfollow an account', async () => {
            const account = {
                id: 1,
                unfollow: vi.fn(),
            } as unknown as AccountEntity;
            const accountToUnfollow = { id: 2 } as unknown as AccountEntity;
            const updatedAccount = {
                id: 1,
            } as unknown as AccountEntity;

            vi.mocked(account.unfollow).mockImplementation(
                () => updatedAccount,
            );

            await accountService.unfollowAccount(account, accountToUnfollow);

            expect(account.unfollow).toHaveBeenCalledWith(accountToUnfollow);
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });
    });

    describe('readAllNotifications', () => {
        it('should read all notifications', async () => {
            const account = {
                id: 1,
                readAllNotifications: vi.fn(),
            } as unknown as AccountEntity;
            const updatedAccount = {
                id: 1,
            } as unknown as AccountEntity;

            vi.mocked(account.readAllNotifications).mockImplementation(
                () => updatedAccount,
            );

            await accountService.readAllNotifications(account);

            expect(account.readAllNotifications).toHaveBeenCalled();
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });
    });
});
