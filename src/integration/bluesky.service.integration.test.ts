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
import { BlueskyEventService } from '@/integration/bluesky-event.service';
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
    let accountRepository: KnexAccountRepository;
    let blueskyApiClient: BlueskyApiClient;
    let blueskyService: BlueskyService;
    let blueskyEventService: BlueskyEventService;
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

        accountRepository = new KnexAccountRepository(client, events);

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

        blueskyEventService = new BlueskyEventService(
            events,
            blueskyService,
            siteService,
            accountRepository,
            logger,
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

    describe('SiteService.disableSiteForHost', () => {
        it('should wait for Bridgy teardown before deleting the site and its users', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();
            await fixtureManager.enableBlueskyIntegration(account);
            blueskyEventService.init();

            let finishSending!: () => void;
            const sending = new Promise<void>((resolve) => {
                finishSending = resolve;
            });
            vi.mocked(fedifyContext.sendActivity).mockReturnValueOnce(sending);

            const disabling = siteService.disableSiteForHost(site.host);

            try {
                await vi.waitFor(() => {
                    expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(1);
                });
                expect(
                    await client('sites').where('id', site.id).first(),
                ).toBeDefined();
                expect(
                    await client('users').where('site_id', site.id).first(),
                ).toBeDefined();
            } finally {
                finishSending();
                await disabling;
            }

            expect(await disabling).toBe(true);
            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(2);
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
        });

        it('should send a stop message, unfollow brid.gy, delete the site, and keep the handle mapping', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();
            const handle = '@test.example.com.ap.brid.gy';
            blueskyEventService.init();

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                handle,
            );

            const deleted = await siteService.disableSiteForHost(site.host);

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
            const [, site] = await fixtureManager.createInternalAccount();
            blueskyEventService.init();

            const deleted = await siteService.disableSiteForHost(site.host);

            expect(deleted).toBe(true);
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
        });

        it('should delete the site when there is no account', async () => {
            const [, site] = await fixtureManager.createInternalAccount();

            await client('users').where('site_id', site.id).delete();
            blueskyEventService.init();

            const deleted = await siteService.disableSiteForHost(site.host);

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
            blueskyEventService.init();

            const deleted = await siteService.disableSiteForHost(site.host);

            expect(deleted).toBe(false);
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeDefined();
        });

        it('should delete the site and retain the handles row when Bridgy teardown fails', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();
            blueskyEventService.init();

            await fixtureManager.enableBlueskyIntegration(account);
            vi.mocked(fedifyContext.sendActivity).mockRejectedValue(
                new Error('bridgy unavailable'),
            );

            await expect(
                siteService.disableSiteForHost(site.host),
            ).resolves.toBe(true);

            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
            expect(Sentry.captureException).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'bridgy unavailable' }),
            );
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeDefined();
        });

        it('should delete the site when account lookup fails', async () => {
            const [, site] = await fixtureManager.createInternalAccount();
            blueskyEventService.init();
            const lookupError = new Error('db unavailable');
            vi.spyOn(accountRepository, 'getBySite').mockRejectedValueOnce(
                lookupError,
            );

            await expect(
                siteService.disableSiteForHost(site.host),
            ).resolves.toBe(true);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(Sentry.captureException).toHaveBeenCalledWith(lookupError);
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
        });

        it('should delete the site and retain the handles row when it has multiple users', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();
            blueskyEventService.init();
            await fixtureManager.enableBlueskyIntegration(account);
            await client('users').insert({
                account_id: account.id,
                site_id: site.id,
            });

            await expect(
                siteService.disableSiteForHost(site.host),
            ).resolves.toBe(true);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(Sentry.captureException).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: `Multiple users found for site: ${site.id}`,
                }),
            );
            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeUndefined();
            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeDefined();
        });

        it('should propagate site deletion errors after Bridgy teardown fails', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();
            blueskyEventService.init();
            await fixtureManager.enableBlueskyIntegration(account);
            vi.mocked(fedifyContext.sendActivity).mockRejectedValue(
                new Error('bridgy unavailable'),
            );

            const deleteError = new Error('site delete failed');
            const failSiteDelete = ({ sql }: { sql: string }) => {
                if (sql.startsWith('delete from `sites`')) {
                    throw deleteError;
                }
            };
            client.on('query', failSiteDelete);

            try {
                await expect(
                    siteService.disableSiteForHost(site.host),
                ).rejects.toThrow(deleteError);
            } finally {
                client.removeListener('query', failSiteDelete);
            }

            expect(
                await client('sites').where('id', site.id).first(),
            ).toBeDefined();
        });
    });

    describe('reconnectForAccount', () => {
        it('should send a follow request when Bluesky is still enabled locally', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);

            await blueskyService.reconnectForAccount(account);

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
            const [account] = await fixtureManager.createInternalAccount();

            await blueskyService.reconnectForAccount(account);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });
    });

    describe('site.created listener', () => {
        it('should ignore an event for an older site at the same host', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();
            await fixtureManager.enableBlueskyIntegration(account);
            blueskyEventService.init();
            const getAccount = vi.spyOn(accountRepository, 'getBySite');

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(site.id + 1, site.host),
            );

            expect(getAccount).not.toHaveBeenCalled();
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it.each(['deleted', 'replaced'])(
            'should skip restore if the site is %s during account lookup',
            async (change) => {
                const [account, site] =
                    await fixtureManager.createInternalAccount();
                await fixtureManager.enableBlueskyIntegration(account);
                blueskyEventService.init();
                vi.spyOn(accountRepository, 'getBySite').mockImplementationOnce(
                    async () => {
                        await client('sites').where('id', site.id).delete();
                        if (change === 'replaced') {
                            await client('sites').insert({
                                host: site.host,
                                webhook_secret: 'replacement-secret',
                            });
                        }
                        return account;
                    },
                );

                await events.emitAsync(
                    SiteCreatedEvent.getName(),
                    new SiteCreatedEvent(site.id, site.host),
                );

                expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            },
        );

        it('should skip Follow when the site from site.created was deleted', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            await client('sites').where('id', site.id).delete();

            blueskyEventService.init();
            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(site.id, site.host),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });
        it('should not restore Bridgy when the Bluesky row is missing', async () => {
            const [, site] = await fixtureManager.createInternalAccount();

            blueskyEventService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(site.id, site.host),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should ignore a missing site', async () => {
            blueskyEventService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(Number.MAX_SAFE_INTEGER, 'missing.tld'),
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

            blueskyEventService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(siteId, 'no-account.tld'),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        });

        it('should swallow reconnect errors without rejecting', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            blueskyEventService.init();

            vi.spyOn(blueskyService, 'reconnectForAccount').mockRejectedValue(
                new Error('bridgy unavailable'),
            );

            await expect(
                events.emitAsync(
                    SiteCreatedEvent.getName(),
                    new SiteCreatedEvent(site.id, site.host),
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
            blueskyEventService.init();

            const deleted = await siteService.disableSiteForHost(site.host);

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
        it('should leave the handles row when Bridgy teardown fails', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            vi.mocked(fedifyContext.sendActivity).mockRejectedValue(
                new Error('bridgy unavailable'),
            );

            await expect(
                blueskyService.disableForAccount(account),
            ).rejects.toThrow('bridgy unavailable');

            expect(
                await client('bluesky_integration_account_handles')
                    .where('account_id', account.id)
                    .first(),
            ).toBeDefined();
        });

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
