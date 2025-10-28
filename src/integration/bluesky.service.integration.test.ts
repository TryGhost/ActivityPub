import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Create, Follow, Note, Undo } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FedifyContext } from '@/app';
import { AsyncEvents } from '@/core/events';
import {
    error,
    getError,
    getValue,
    isError,
    type Ok,
    ok,
    type Error as ResultError,
} from '@/core/result';
import { BlueskyService, BRIDGY_AP_ID } from '@/integration/bluesky.service';
import type { BlueskyApiClient } from '@/integration/bluesky-api.client';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('BlueskyService', () => {
    let client: Knex;
    let events: AsyncEvents;
    let fixtureManager: FixtureManager;
    let fedifyContext: FedifyContext;
    let fedifyContextFactory: FedifyContextFactory;
    let logger: Logger;
    let accountService: AccountService;
    let blueskyApiClient: BlueskyApiClient;
    let blueskyService: BlueskyService;

    const bridgyAccount = {
        id: 123,
        apId: BRIDGY_AP_ID,
        apInbox: new URL(`${BRIDGY_AP_ID.href}/inbox`),
    } as Account;

    beforeAll(async () => {
        client = await createTestDb();
        events = new AsyncEvents();
        fixtureManager = createFixtureManager(client, events);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        events.removeAllListeners();

        const accountRepository = new KnexAccountRepository(client, events);

        fedifyContext = {
            sendActivity: vi.fn().mockResolvedValue(undefined),
            getObjectUri: (type: { name: string }, { id }: { id: string }) =>
                new URL(`https://example.com/${type.name.toLowerCase()}/${id}`),
            data: {
                globaldb: {
                    set: vi.fn().mockResolvedValue(undefined),
                },
            },
        } as unknown as FedifyContext;

        fedifyContextFactory = new FedifyContextFactory();

        fedifyContextFactory.getFedifyContext = vi
            .fn()
            .mockReturnValue(fedifyContext);

        logger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        } as unknown as Logger;

        accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );

        accountService.ensureByApId = vi
            .fn()
            .mockImplementation(async (url: URL) => {
                if (url.href === BRIDGY_AP_ID.href) {
                    return ok(bridgyAccount);
                }

                return error(
                    new Error(`Unexpected ensureByApId call with ${url.href}`),
                );
            });

        blueskyApiClient = {
            searchActors: vi.fn(),
        } as unknown as BlueskyApiClient;

        blueskyService = new BlueskyService(
            client,
            accountService,
            accountRepository,
            fedifyContextFactory,
            logger,
            blueskyApiClient,
        );

        vi.clearAllMocks();
    });

    describe('enableForAccount', () => {
        it('should send a follow request to brid.gy', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await blueskyService.enableForAccount(account);

            // Verify sendActivity was called with the expected arguments
            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(1);
            expect(fedifyContext.sendActivity).toHaveBeenCalledWith(
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Follow),
            );

            // Verify the Follow activity is correct
            const followActivity = vi.mocked(fedifyContext.sendActivity).mock
                .calls[0][2];
            expect(followActivity).toBeInstanceOf(Follow);
            expect(followActivity.id).toBeInstanceOf(URL);
            expect(followActivity.id!.href).toContain('/follow/');
            expect(followActivity.actorId).toEqual(account.apId);
            expect(followActivity.objectId).toEqual(BRIDGY_AP_ID);

            // Verify the Follow activity was stored in the globaldb
            expect(fedifyContext.data.globaldb.set).toHaveBeenCalledTimes(1);
            expect(fedifyContext.data.globaldb.set).toHaveBeenCalledWith(
                [followActivity.id!.href],
                await followActivity.toJsonLd(),
            );

            // Verify handle mapping was created with null handle and unconfirmed status
            const handleMapping = await client(
                'bluesky_integration_account_handles',
            )
                .where('account_id', account.id)
                .first();

            expect(handleMapping).toBeDefined();
            expect(handleMapping.handle).toBeNull();
            expect(handleMapping.confirmed).toBe(0);
        });

        it('should not send a follow request to brid.gy if the Bluesky integration is already enabled for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            await blueskyService.enableForAccount(account);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(fedifyContext.data.globaldb.set).not.toHaveBeenCalled();
        });

        it('should return details about the Bluesky integration', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const result = await blueskyService.enableForAccount(account);

            expect(result).toEqual({
                enabled: true,
                handleConfirmed: false,
                handle: null,
            });
        });
    });

    describe('disableForAccount', () => {
        it('should send a stop message, unfollow brid.gy, and delete the handle mapping', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            await blueskyService.disableForAccount(account);

            // Verify sendActivity was called twice (once for DM, once for unfollow)
            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(2);

            // Verify the first call sends a Create activity with a Note containing "stop"
            expect(fedifyContext.sendActivity).toHaveBeenNthCalledWith(
                1,
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Create),
            );

            // Verify the Create activity structure
            const createActivity = vi.mocked(fedifyContext.sendActivity).mock
                .calls[0][2];
            expect(createActivity).toBeInstanceOf(Create);
            expect(createActivity.id).toBeInstanceOf(URL);
            expect(createActivity.id!.href).toContain('/create/');
            expect(createActivity.actorId).toEqual(account.apId);
            expect(createActivity.toId).toEqual(bridgyAccount.apId);

            const createActivityObject = await createActivity.getObject();
            expect(createActivityObject).toBeInstanceOf(Note);
            expect(createActivityObject!.id).toBeInstanceOf(URL);
            expect(createActivityObject!.id!.href).toContain('/note/');
            expect(createActivityObject!.attributionId).toEqual(account.apId);
            expect(createActivityObject!.content).toBe('stop');
            expect(createActivityObject!.published).toBeInstanceOf(
                Temporal.Instant,
            );
            expect(createActivityObject!.toId).toEqual(bridgyAccount.apId);

            // Verify the second call sends an Undo activity for the Follow
            expect(fedifyContext.sendActivity).toHaveBeenNthCalledWith(
                2,
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Undo),
            );

            // Verify the Undo activity structure
            const undoActivity = vi.mocked(fedifyContext.sendActivity).mock
                .calls[1][2];
            expect(undoActivity).toBeInstanceOf(Undo);
            expect(undoActivity.id).toBeInstanceOf(URL);
            expect(undoActivity.id!.href).toContain('/undo/');
            expect(undoActivity.actorId).toEqual(account.apId);

            const undoActivityObject = await undoActivity.getObject();
            expect(undoActivityObject).toBeInstanceOf(Follow);
            expect(undoActivityObject!.id).toBeNull();
            expect((undoActivityObject as Follow).actorId).toEqual(
                account.apId,
            );
            expect((undoActivityObject as Follow).objectId).toEqual(
                bridgyAccount.apId,
            );

            // Verify activities were stored in globaldb (Note, Create, Undo)
            expect(fedifyContext.data.globaldb.set).toHaveBeenCalledTimes(3);

            // Verify each activity was stored with its ID
            expect(fedifyContext.data.globaldb.set).toHaveBeenCalledWith(
                [createActivityObject!.id!.href],
                await createActivityObject!.toJsonLd(),
            );
            expect(fedifyContext.data.globaldb.set).toHaveBeenCalledWith(
                [createActivity.id!.href],
                await createActivity!.toJsonLd(),
            );
            expect(fedifyContext.data.globaldb.set).toHaveBeenCalledWith(
                [undoActivity.id!.href],
                await undoActivity.toJsonLd(),
            );

            // Verify the handle mapping was deleted
            const handleMappingPostDisable = await client(
                'bluesky_integration_account_handles',
            )
                .where('account_id', account.id)
                .first();

            expect(handleMappingPostDisable).toBeUndefined();
        });

        it('should do nothing if the Bluesky integration is already disabled for the account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await blueskyService.disableForAccount(account);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(fedifyContext.data.globaldb.set).not.toHaveBeenCalled();
        });
    });

    describe('confirmHandleForAccount', () => {
        it('should return the existing handle if already confirmed', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const handle = '@test.example.com.ap.brid.gy';

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                handle,
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(isError(result)).toBe(false);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle,
            });

            expect(blueskyApiClient.searchActors).not.toHaveBeenCalled();
        });

        it('should return an error if the Bluesky integration is not enabled', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(isError(result)).toBe(true);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-enabled',
            });
        });

        it('should query the Bluesky API and update the database when a handle is found', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const expectedHandle = `@test.${account.apId.hostname}.ap.brid.gy`;

            await fixtureManager.enableBlueskyIntegration(account, false);

            vi.mocked(blueskyApiClient.searchActors).mockResolvedValue(
                ok([
                    {
                        handle: expectedHandle,
                        labels: [
                            {
                                val: 'bridged-from-bridgy-fed-activitypub',
                            },
                        ],
                    },
                    {
                        handle: 'other.bsky.social',
                    },
                ]),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(blueskyApiClient.searchActors).toHaveBeenCalledWith(
                account.apId.hostname,
            );

            expect(isError(result)).toBe(false);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle: expectedHandle,
            });

            const row = await client('bluesky_integration_account_handles')
                .where('account_id', account.id)
                .first();

            expect(row.confirmed).toBe(1);
            expect(row.handle).toBe(expectedHandle);
        });

        it('should return an unconfirmed status when a handle is not found', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account, false);

            (
                blueskyApiClient.searchActors as ReturnType<typeof vi.fn>
            ).mockResolvedValue(
                ok([
                    {
                        handle: 'other.bsky.social',
                    },
                    {
                        handle: 'different.domain.ap.brid.gy',
                        labels: [
                            {
                                val: 'bridged-from-bridgy-fed-activitypub',
                            },
                        ],
                    },
                ]),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(blueskyApiClient.searchActors).toHaveBeenCalledWith(
                account.apId.hostname,
            );

            expect(isError(result)).toBe(false);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: false,
                handle: null,
            });

            const row = await client('bluesky_integration_account_handles')
                .where('account_id', account.id)
                .first();

            expect(row.confirmed).toBe(0);
            expect(row.handle).toBeNull();
        });

        it('should return an error when the Bluesky API fails', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account, false);

            const apiError = {
                type: 'network-error' as const,
                message: 'Connection timeout',
            };

            vi.mocked(blueskyApiClient.searchActors).mockResolvedValue(
                error(apiError),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(isError(result)).toBe(true);

            expect(getError(result as ResultError<unknown>)).toEqual(apiError);
        });
    });
});
