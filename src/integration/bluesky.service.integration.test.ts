import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Create, Follow, Note, Undo } from '@fedify/vocab';
import type { Logger } from '@logtape/logtape';
import * as Sentry from '@sentry/node';
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
import { SiteService } from '@/site/site.service';
import { SiteCreatedEvent } from '@/site/site-created.event';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

vi.mock('@sentry/node', () => ({
    captureException: vi.fn(),
}));

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
    let siteService: SiteService;

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
            events,
        );

        siteService = new SiteService(
            client,
            accountService,
            {
                async getSiteSettings(host: string) {
                    return {
                        site: {
                            title: `Site ${host} title`,
                            description: `Site ${host} description`,
                            icon: `https://${host}/favicon.ico`,
                            cover_image: `https://${host}/cover.png`,
                            site_uuid: crypto.randomUUID(),
                            url: `https://${host}/`,
                        },
                    };
                },
            },
            logger,
            events,
            blueskyService,
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

    describe('SiteService.softDisconnectSite', () => {
        it('should send a stop message, unfollow brid.gy, delete the site, and keep the handle mapping', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();
            const handle = '@test.example.com.ap.brid.gy';

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                handle,
            );

            const deleted = await siteService.softDisconnectSite(account, site);

            expect(deleted).toBe(true);
            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(2);
            expect(fedifyContext.sendActivity).toHaveBeenNthCalledWith(
                1,
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Create),
            );
            expect(fedifyContext.sendActivity).toHaveBeenNthCalledWith(
                2,
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Undo),
            );

            const handleMapping = await client(
                'bluesky_integration_account_handles',
            )
                .where('account_id', account.id)
                .first();

            expect(handleMapping).toBeDefined();
            expect(handleMapping.handle).toBe(handle);
            expect(handleMapping.confirmed).toBe(1);
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
        });

        it('should delete the site when Bluesky is not enabled', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            const deleted = await siteService.softDisconnectSite(account, site);

            expect(deleted).toBe(true);
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
        });

        it('should delete the site when there is no account', async () => {
            const [, site] = await fixtureManager.createInternalAccount();

            const deleted = await siteService.softDisconnectSite(null, site);

            expect(deleted).toBe(true);
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
        });

        it('should skip Bridgy teardown when the site is already gone', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            await client('sites').where('id', site.id).delete();

            const deleted = await siteService.softDisconnectSite(account, site);

            expect(deleted).toBe(false);
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeDefined();
        });
    });

    describe('reconnectBridgyForAccount', () => {
        it('should send a follow request when Bluesky is still enabled locally', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            await blueskyService.reconnectBridgyForAccount(account, site.id);

            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(1);
            expect(fedifyContext.sendActivity).toHaveBeenCalledWith(
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Follow),
            );

            const handleMapping = await client(
                'bluesky_integration_account_handles',
            )
                .where('account_id', account.id)
                .first();

            expect(handleMapping).toBeDefined();
        });

        it('should do nothing if the Bluesky integration is not enabled', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await blueskyService.reconnectBridgyForAccount(account, site.id);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should skip Follow when the site from site.created was deleted', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            await client('sites').where('id', site.id).delete();

            await blueskyService.reconnectBridgyForAccount(account, site.id);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not Follow after Preferences disable wins the handles row lock', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            let releaseDisable!: () => void;
            const disableGate = new Promise<void>((resolve) => {
                releaseDisable = resolve;
            });
            let disableStarted = false;

            vi.mocked(fedifyContext.sendActivity).mockImplementation(
                async (_sender, _recipient, activity) => {
                    if (activity instanceof Create) {
                        disableStarted = true;
                        await disableGate;
                    }
                },
            );

            const disablePromise = blueskyService.disableForAccount(account);

            await vi.waitFor(() => {
                expect(disableStarted).toBe(true);
            });

            const reconnectPromise = blueskyService.reconnectBridgyForAccount(
                account,
                site.id,
            );

            releaseDisable();
            await Promise.all([disablePromise, reconnectPromise]);

            const activities = vi
                .mocked(fedifyContext.sendActivity)
                .mock.calls.map((call) => call[2]);

            expect(
                activities.some((activity) => activity instanceof Follow),
            ).toBe(false);
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeUndefined();
        });

        it('should let Preferences disable tear down after reconnect wins the handles row lock', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            let releaseFollow!: () => void;
            const followGate = new Promise<void>((resolve) => {
                releaseFollow = resolve;
            });
            let followStarted = false;

            vi.mocked(fedifyContext.sendActivity).mockImplementation(
                async (_sender, _recipient, activity) => {
                    if (activity instanceof Follow) {
                        followStarted = true;
                        await followGate;
                    }
                },
            );

            const reconnectPromise = blueskyService.reconnectBridgyForAccount(
                account,
                site.id,
            );

            await vi.waitFor(() => {
                expect(followStarted).toBe(true);
            });

            const disablePromise = blueskyService.disableForAccount(account);

            releaseFollow();
            await Promise.all([reconnectPromise, disablePromise]);

            const activities = vi
                .mocked(fedifyContext.sendActivity)
                .mock.calls.map((call) => call[2]);

            expect(activities[0]).toBeInstanceOf(Follow);
            expect(
                activities.some((activity) => activity instanceof Create),
            ).toBe(true);
            expect(
                activities.some((activity) => activity instanceof Undo),
            ).toBe(true);
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeUndefined();
        });

        it('should not Follow after soft disconnect wins the handles row lock', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            let releaseDisconnect!: () => void;
            const disconnectGate = new Promise<void>((resolve) => {
                releaseDisconnect = resolve;
            });
            let disconnectStarted = false;

            vi.mocked(fedifyContext.sendActivity).mockImplementation(
                async (_sender, _recipient, activity) => {
                    if (activity instanceof Create) {
                        disconnectStarted = true;
                        await disconnectGate;
                    }
                },
            );

            const disconnectPromise = siteService.softDisconnectSite(
                account,
                site,
            );

            await vi.waitFor(() => {
                expect(disconnectStarted).toBe(true);
            });

            const reconnectPromise = blueskyService.reconnectBridgyForAccount(
                account,
                site.id,
            );

            releaseDisconnect();
            await Promise.all([disconnectPromise, reconnectPromise]);

            const activities = vi
                .mocked(fedifyContext.sendActivity)
                .mock.calls.map((call) => call[2]);

            expect(
                activities.some((activity) => activity instanceof Follow),
            ).toBe(false);
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeDefined();
        });

        it('should let soft disconnect tear down after reconnect wins the handles row lock', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            let releaseFollow!: () => void;
            const followGate = new Promise<void>((resolve) => {
                releaseFollow = resolve;
            });
            let followStarted = false;

            vi.mocked(fedifyContext.sendActivity).mockImplementation(
                async (_sender, _recipient, activity) => {
                    if (activity instanceof Follow) {
                        followStarted = true;
                        await followGate;
                    }
                },
            );

            const reconnectPromise = blueskyService.reconnectBridgyForAccount(
                account,
                site.id,
            );

            await vi.waitFor(() => {
                expect(followStarted).toBe(true);
            });

            const disconnectPromise = siteService.softDisconnectSite(
                account,
                site,
            );

            releaseFollow();
            await Promise.all([reconnectPromise, disconnectPromise]);

            const activities = vi
                .mocked(fedifyContext.sendActivity)
                .mock.calls.map((call) => call[2]);

            expect(activities[0]).toBeInstanceOf(Follow);
            expect(
                activities.some((activity) => activity instanceof Create),
            ).toBe(true);
            expect(
                activities.some((activity) => activity instanceof Undo),
            ).toBe(true);
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeDefined();
        });
    });

    describe('site.created listener', () => {
        it('should restore Bridgy when the Bluesky row exists', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            await blueskyService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(site.id),
            );

            expect(fedifyContext.sendActivity).toHaveBeenCalledWith(
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Follow),
            );
        });

        it('should not restore Bridgy when the Bluesky row is missing', async () => {
            const [, site] = await fixtureManager.createInternalAccount();

            await blueskyService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(site.id),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should ignore a missing site', async () => {
            await blueskyService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(Number.MAX_SAFE_INTEGER),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should ignore a site with no account', async () => {
            const [siteId] = await client('sites').insert({
                host: 'no-account.tld',
                webhook_secret: 'secret',
                ghost_uuid: 'no-account-uuid',
            });

            await blueskyService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(siteId),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should swallow reconnect errors without rejecting', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            await blueskyService.init();

            vi.spyOn(
                blueskyService,
                'reconnectBridgyForAccount',
            ).mockRejectedValue(new Error('bridgy unavailable'));

            await expect(
                events.emitAsync(
                    SiteCreatedEvent.getName(),
                    new SiteCreatedEvent(site.id),
                ),
            ).resolves.toBe(true);

            expect(logger.error).toHaveBeenCalled();
            expect(Sentry.captureException).toHaveBeenCalled();
        });

        it('should restore Bridgy after soft disconnect and site recreate', async () => {
            const host = 'restore-cycle.example';
            const [account, site] = await fixtureManager.createInternalAccount(
                null,
                host,
            );
            const handle = '@restore-cycle.example.com.ap.brid.gy';

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                handle,
            );
            await blueskyService.init();

            const deleted = await siteService.softDisconnectSite(account, site);

            expect(deleted).toBe(true);
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();

            // Test DBs clone table DDL without FK constraints. Production deletes
            // users via ON DELETE CASCADE when the site row goes away.
            await client('users').where('account_id', account.id).delete();

            expect(
                await client('users').where('account_id', account.id).first(),
            ).toBeUndefined();
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toMatchObject({
                handle,
                confirmed: 1,
            });

            vi.mocked(fedifyContext.sendActivity).mockClear();

            const recreatedSite = await siteService.initialiseSiteForHost(host);

            expect(recreatedSite.host).toBe(host);
            expect(recreatedSite.id).not.toBe(site.id);

            const reattachedUser = await client('users')
                .where('site_id', recreatedSite.id)
                .first();

            expect(reattachedUser?.account_id).toBe(account.id);

            await vi.waitFor(() => {
                expect(fedifyContext.sendActivity).toHaveBeenCalledWith(
                    { username: account.username },
                    {
                        id: bridgyAccount.apId,
                        inboxId: bridgyAccount.apInbox,
                    },
                    expect.any(Follow),
                );
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
