import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Create, Follow, Note, Undo } from '@fedify/vocab';
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
import type { AtprotoHandleResolver } from '@/integration/atproto-handle.resolver';
import {
    BlueskyService,
    BRIDGY_AP_ID,
    DOMAIN_HANDLE_CLAIM_TIMEOUT_MS,
} from '@/integration/bluesky.service';
import type { BlueskyApiClient } from '@/integration/bluesky-api.client';
import { BlueskyEventService } from '@/integration/bluesky-event.service';
import type { BridgyFedClient } from '@/integration/bridgy-fed.client';
import { SiteService } from '@/site/site.service';
import { SiteCreatedEvent } from '@/site/site-created.event';
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
    let accountRepository: KnexAccountRepository;
    let blueskyApiClient: BlueskyApiClient;
    let bridgyFedClient: BridgyFedClient;
    let atprotoHandleResolver: AtprotoHandleResolver;
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
            getProfile: vi.fn(),
        } as unknown as BlueskyApiClient;

        bridgyFedClient = {
            getBridgedDid: vi.fn(),
        } as unknown as BridgyFedClient;

        atprotoHandleResolver = {
            resolveDns: vi.fn(),
            resolveHttps: vi.fn(),
        } as unknown as AtprotoHandleResolver;

        blueskyService = new BlueskyService(
            client,
            accountService,
            accountRepository,
            fedifyContextFactory,
            logger,
            blueskyApiClient,
            bridgyFedClient,
            atprotoHandleResolver,
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
            expect(handleMapping.domain_handle_automatic).toBe(1);
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
                domainHandle: null,
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
            expect(logger.error).toHaveBeenCalledWith(
                'Could not disconnect Bridgy for site {host}',
                {
                    host: site.host,
                    error: expect.objectContaining({
                        message: 'bridgy unavailable',
                    }),
                },
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
            expect(logger.error).toHaveBeenCalledWith(
                'Could not disconnect Bridgy for site {host}',
                { host: site.host, error: lookupError },
            );
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
            expect(logger.error).toHaveBeenCalledWith(
                'Could not disconnect Bridgy for site {host}',
                {
                    host: site.host,
                    error: expect.objectContaining({
                        message: `Multiple users found for site: ${site.id}`,
                    }),
                },
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
        it('should skip Follow when the site from site.created was deleted', async () => {
            const [account, site] =
                await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account);
            await client('sites').where('id', site.id).delete();

            blueskyEventService.init();
            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(site.host),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });
        it('should not restore Bridgy when the Bluesky row is missing', async () => {
            const [, site] = await fixtureManager.createInternalAccount();

            blueskyEventService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent(site.host),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should ignore a missing site', async () => {
            blueskyEventService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent('missing.tld'),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should ignore a site with no account', async () => {
            await client('sites').insert({
                host: 'no-account.tld',
                webhook_secret: 'secret',
                ghost_uuid: 'no-account-uuid',
            });

            blueskyEventService.init();

            await events.emitAsync(
                SiteCreatedEvent.getName(),
                new SiteCreatedEvent('no-account.tld'),
            );

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
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
                    new SiteCreatedEvent(site.host),
                ),
            ).resolves.toBe(true);

            expect(logger.error).toHaveBeenCalledWith(
                'Best-effort Bridgy restore failed for site {host}',
                {
                    host: site.host,
                    error: expect.objectContaining({
                        message: 'bridgy unavailable',
                    }),
                },
            );
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
        const did = 'did:plc:bridged';
        const otherDid = 'did:plc:someoneelse';

        let account: Account;
        let domain: string;
        let defaultHandle: string;

        beforeEach(async () => {
            [account] = await fixtureManager.createInternalAccount();
            domain = account.apId.hostname;
            defaultHandle = `${account.username}.${domain}.ap.brid.gy`;

            vi.mocked(bridgyFedClient.getBridgedDid).mockResolvedValue(ok(did));
            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: defaultHandle }),
            );
            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([]),
            );
            // Nothing is served before the claim, our DID after it
            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(did);
        });

        // As enabling Bluesky sharing does
        async function enableNewIntegration() {
            await fixtureManager.enableBlueskyIntegration(
                account,
                false,
                undefined,
                { domain_handle_automatic: true },
            );
        }

        async function getRow() {
            return client('bluesky_integration_account_handles')
                .where('account_id', account.id)
                .first();
        }

        async function getSentDms() {
            const contents: string[] = [];

            for (const [, , activity] of vi.mocked(fedifyContext.sendActivity)
                .mock.calls) {
                if (activity instanceof Create) {
                    const note = await activity.getObject();
                    contents.push(String(note?.content));
                }
            }

            return contents;
        }

        it('should return an error if the Bluesky integration is not enabled', async () => {
            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(isError(result)).toBe(true);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-enabled',
            });
        });

        it('should return the stored details without checking again once settled', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                domain,
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'active',
                },
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle: domain,
                domainHandle: {
                    domain,
                    status: 'active',
                    reason: null,
                    automatic: false,
                },
            });

            expect(bridgyFedClient.getBridgedDid).not.toHaveBeenCalled();
            expect(blueskyApiClient.getProfile).not.toHaveBeenCalled();
        });

        it('should return an unconfirmed status while the account is not bridged yet', async () => {
            await enableNewIntegration();

            vi.mocked(bridgyFedClient.getBridgedDid).mockResolvedValue(
                error({ type: 'not-found' }),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: false,
                handle: null,
                domainHandle: null,
            });

            expect(blueskyApiClient.getProfile).not.toHaveBeenCalled();
        });

        it('should store the DID and return an unconfirmed status while the profile is not available', async () => {
            await enableNewIntegration();

            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                error({ type: 'not-found' }),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: false,
                handle: null,
                domainHandle: null,
            });

            expect((await getRow()).did).toBe(did);
        });

        it('should return an error when Bridgy Fed fails', async () => {
            await enableNewIntegration();

            const apiError = {
                type: 'network-error' as const,
                message: 'Connection timeout',
            };

            vi.mocked(bridgyFedClient.getBridgedDid).mockResolvedValue(
                error(apiError),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual(apiError);
        });

        it('should return an error when the Bluesky API fails', async () => {
            await enableNewIntegration();

            const apiError = {
                type: 'api-error' as const,
                status: 500,
                message: 'API returned status 500',
            };

            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                error(apiError),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual(apiError);
        });

        it('should not confirm an invalid handle', async () => {
            await enableNewIntegration();

            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: 'handle.invalid' }),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: false,
                handle: null,
                domainHandle: null,
            });
        });

        it('should confirm the handle and claim the domain handle', async () => {
            await enableNewIntegration();

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle: defaultHandle,
                domainHandle: {
                    domain,
                    status: 'claiming',
                    reason: null,
                    automatic: true,
                },
            });

            expect(atprotoHandleResolver.resolveDns).toHaveBeenCalledWith(
                domain,
            );
            expect(await getSentDms()).toEqual([`username ${domain}`]);

            const row = await getRow();
            expect(row.did).toBe(did);
            expect(row.confirmed).toBe(1);
            expect(row.domain_handle_claimed_at).toBeInstanceOf(Date);
        });

        it('should send the username message to brid.gy', async () => {
            await enableNewIntegration();

            await blueskyService.confirmHandleForAccount(account);

            expect(fedifyContext.sendActivity).toHaveBeenCalledWith(
                { username: account.username },
                {
                    id: bridgyAccount.apId,
                    inboxId: bridgyAccount.apInbox,
                },
                expect.any(Create),
            );

            const create = vi.mocked(fedifyContext.sendActivity).mock
                .calls[0][2] as Create;
            const note = await create.getObject();

            expect(create.actorId).toEqual(account.apId);
            expect(create.toId).toEqual(bridgyAccount.apId);
            expect(note).toBeInstanceOf(Note);
            expect(note!.attributionId).toEqual(account.apId);
            expect(note!.toId).toEqual(bridgyAccount.apId);
            expect(fedifyContext.data.globaldb.set).toHaveBeenCalledWith(
                [note!.id!.href],
                await note!.toJsonLd(),
            );
        });

        it('should not set up the domain handle for an account that enabled Bluesky sharing before domain handles existed', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(
                (getValue(result as Ok<unknown>) as { domainHandle: unknown })
                    .domainHandle,
            ).toBeNull();

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(atprotoHandleResolver.resolveDns).not.toHaveBeenCalled();
        });

        it('should not claim a domain that points at another account in DNS', async () => {
            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([otherDid]),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(
                (getValue(result as Ok<unknown>) as { domainHandle: unknown })
                    .domainHandle,
            ).toEqual({
                domain,
                status: 'unavailable',
                reason: 'taken',
                automatic: true,
            });

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(atprotoHandleResolver.resolveHttps).not.toHaveBeenCalled();
            expect(await blueskyService.getDomainHandleDid(account)).toBeNull();
        });

        it('should not claim a domain with DNS records for several accounts', async () => {
            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([did, otherDid]),
            );

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_reason).toBe('taken');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not claim a domain that serves another account over HTTPS', async () => {
            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValue(otherDid);

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_reason).toBe('taken');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not claim a domain when its DNS cannot be checked', async () => {
            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                error({ type: 'dns-error', code: 'ESERVFAIL' }),
            );

            await blueskyService.confirmHandleForAccount(account);

            const row = await getRow();
            expect(row.domain_handle_status).toBe('unavailable');
            expect(row.domain_handle_reason).toBe('dns_error');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not claim a domain that does not serve the DID', async () => {
            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValue(null);

            await blueskyService.confirmHandleForAccount(account);

            const row = await getRow();
            expect(row.domain_handle).toBe(domain);
            expect(row.domain_handle_status).toBe('unavailable');
            expect(row.domain_handle_reason).toBe('not_reachable');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(await blueskyService.getDomainHandleDid(account)).toBeNull();
        });

        it('should claim a domain whose DNS already points at the account', async () => {
            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([did]),
            );
            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValue(null);

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_status).toBe('claiming');
            expect(await getSentDms()).toEqual([`username ${domain}`]);
        });

        it('should fall back to the www host when the root domain is taken', async () => {
            const [wwwAccount] = await fixtureManager.createInternalAccount(
                null,
                'www.example-www.com',
            );
            account = wwwAccount;

            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveDns).mockImplementation(
                async (candidate) =>
                    ok(candidate === 'example-www.com' ? [otherDid] : []),
            );

            await blueskyService.confirmHandleForAccount(account);

            const row = await getRow();
            expect(row.domain_handle).toBe('www.example-www.com');
            expect(row.domain_handle_status).toBe('claiming');
            expect(await getSentDms()).toEqual([
                'username www.example-www.com',
            ]);
        });

        it('should report why the root domain is unavailable when no domain can be used', async () => {
            const [wwwAccount] = await fixtureManager.createInternalAccount(
                null,
                'www.example-none.com',
            );
            account = wwwAccount;

            await enableNewIntegration();

            vi.mocked(atprotoHandleResolver.resolveDns).mockImplementation(
                async (candidate) =>
                    ok(candidate === 'example-none.com' ? [otherDid] : []),
            );
            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValue(null);

            await blueskyService.confirmHandleForAccount(account);

            const row = await getRow();
            expect(row.domain_handle).toBe('example-none.com');
            expect(row.domain_handle_status).toBe('unavailable');
            expect(row.domain_handle_reason).toBe('taken');
        });

        it('should mark the domain handle as active without a message when the account already uses it', async () => {
            await enableNewIntegration();

            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: domain }),
            );

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_status).toBe('active');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should mark a claimed domain handle as active once Bridgy Fed switches to it', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'claiming',
                    domain_handle_claimed_at: new Date(),
                },
            );

            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: domain }),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle: domain,
                domainHandle: {
                    domain,
                    status: 'active',
                    reason: null,
                    automatic: false,
                },
            });
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should keep waiting for Bridgy Fed to switch to a claimed domain handle', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'claiming',
                    domain_handle_claimed_at: new Date(),
                },
            );

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_status).toBe('claiming');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should give up on a claimed domain handle that Bridgy Fed did not switch to', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'claiming',
                    domain_handle_claimed_at: new Date(
                        Date.now() - DOMAIN_HANDLE_CLAIM_TIMEOUT_MS - 1000,
                    ),
                },
            );

            await blueskyService.confirmHandleForAccount(account);

            const row = await getRow();
            expect(row.domain_handle_status).toBe('unavailable');
            expect(row.domain_handle_reason).toBe('rejected');
            expect(await blueskyService.getDomainHandleDid(account)).toBeNull();
        });

        it('should not set up the domain handle again after it was released', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'released',
                },
            );

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_status).toBe('released');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should take the handle over from another row that still has it', async () => {
            const [otherAccount] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(
                otherAccount,
                true,
                defaultHandle,
            );
            await enableNewIntegration();

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).handle).toBe(defaultHandle);

            const otherRow = await client('bluesky_integration_account_handles')
                .where('account_id', otherAccount.id)
                .first();
            expect(otherRow.handle).toBeNull();
        });

        it('should leave the domain handle untried when the message cannot be sent', async () => {
            await enableNewIntegration();

            vi.mocked(fedifyContext.sendActivity).mockRejectedValue(
                new Error('Failed to send'),
            );

            await expect(
                blueskyService.confirmHandleForAccount(account),
            ).rejects.toThrow('Failed to send');

            const row = await getRow();
            expect(row.domain_handle).toBeNull();
            expect(row.domain_handle_status).toBeNull();
        });
    });

    describe('claim races and DNS precedence', () => {
        const did = 'did:plc:bridged';
        const otherDid = 'did:plc:someoneelse';

        let account: Account;
        let domain: string;
        let defaultHandle: string;

        beforeEach(async () => {
            [account] = await fixtureManager.createInternalAccount();
            domain = account.apId.hostname;
            defaultHandle = `${account.username}.${domain}.ap.brid.gy`;

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                { did, domain_handle_automatic: true },
            );

            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: defaultHandle }),
            );
            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([]),
            );
            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(did);
        });

        async function getRow() {
            return client('bluesky_integration_account_handles')
                .where('account_id', account.id)
                .first();
        }

        async function setRow(values: Record<string, unknown>) {
            await client('bluesky_integration_account_handles')
                .where('account_id', account.id)
                .update(values);
        }

        it('should claim a domain whose DNS points at the account even if it serves another DID', async () => {
            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([did]),
            );
            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValue(otherDid);

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_status).toBe('claiming');
            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(1);
        });

        it('should not claim the domain when another request claimed it first', async () => {
            const otherClaimAt = new Date('2026-01-01T00:00:00.000Z');

            vi.mocked(atprotoHandleResolver.resolveDns).mockImplementation(
                async () => {
                    await setRow({
                        domain_handle: domain,
                        domain_handle_status: 'claiming',
                        domain_handle_claimed_at: otherClaimAt,
                    });

                    return ok([]);
                },
            );

            await blueskyService.confirmHandleForAccount(account);

            const row = await getRow();
            expect(row.domain_handle_status).toBe('claiming');
            expect(row.domain_handle_claimed_at).toEqual(otherClaimAt);
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not claim the domain when the site moved to another domain meanwhile', async () => {
            vi.mocked(atprotoHandleResolver.resolveDns).mockImplementation(
                async () => {
                    await setRow({ domain_handle_status: 'released' });

                    return ok([]);
                },
            );

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_status).toBe('released');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(await blueskyService.getDomainHandleDid(account)).toBeNull();
        });

        it('should leave a newer claim alone when its own claim fails', async () => {
            const newerClaimAt = new Date('2030-01-01T00:00:00.000Z');

            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValueOnce(null)
                .mockImplementationOnce(async () => {
                    // Another request claims the domain again before this
                    // request's self-check fails
                    await setRow({ domain_handle_claimed_at: newerClaimAt });

                    return null;
                });

            await blueskyService.confirmHandleForAccount(account);

            const row = await getRow();
            expect(row.domain_handle).toBe(domain);
            expect(row.domain_handle_status).toBe('claiming');
            expect(row.domain_handle_claimed_at).toEqual(newerClaimAt);
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not mark a released domain handle as active', async () => {
            await setRow({
                domain_handle: domain,
                domain_handle_status: 'claiming',
                domain_handle_claimed_at: new Date(),
            });

            vi.mocked(blueskyApiClient.getProfile).mockImplementation(
                async () => {
                    await setRow({ domain_handle_status: 'released' });

                    return ok({ did, handle: domain });
                },
            );

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_status).toBe('released');
        });

        it('should only serve the DID for the claimed domain when asked for a domain', async () => {
            await setRow({
                domain_handle: domain,
                domain_handle_status: 'active',
            });

            expect(
                await blueskyService.getDomainHandleDid(account, domain),
            ).toBe(did);
            expect(
                await blueskyService.getDomainHandleDid(
                    account,
                    domain.toUpperCase(),
                ),
            ).toBe(did);
            expect(
                await blueskyService.getDomainHandleDid(
                    account,
                    `www.${domain}`,
                ),
            ).toBeNull();
        });
    });

    describe('useDomainHandleForAccount', () => {
        const did = 'did:plc:bridged';

        it('should claim the domain handle when asked to', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const domain = account.apId.hostname;

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                'index.example.com.ap.brid.gy',
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'unavailable',
                    domain_handle_reason: 'not_reachable',
                },
            );

            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: 'index.example.com.ap.brid.gy' }),
            );
            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([]),
            );
            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(did);

            const result =
                await blueskyService.useDomainHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle: 'index.example.com.ap.brid.gy',
                domainHandle: {
                    domain,
                    status: 'claiming',
                    reason: null,
                    automatic: false,
                },
            });
            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(1);
        });

        it('should claim the domain handle for an account that enabled Bluesky sharing before domain handles existed', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const domain = account.apId.hostname;
            const defaultHandle = `${account.username}.${domain}.ap.brid.gy`;

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
            );

            vi.mocked(bridgyFedClient.getBridgedDid).mockResolvedValue(ok(did));
            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: defaultHandle }),
            );
            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([]),
            );
            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(did);

            const result =
                await blueskyService.useDomainHandleForAccount(account);

            expect(
                (getValue(result as Ok<unknown>) as { domainHandle: unknown })
                    .domainHandle,
            ).toEqual({
                domain,
                status: 'claiming',
                reason: null,
                automatic: false,
            });

            const create = vi.mocked(fedifyContext.sendActivity).mock
                .calls[0][2] as Create;
            expect((await create.getObject())!.content).toBe(
                `username ${domain}`,
            );
        });

        it('should return an error if the Bluesky integration is not enabled', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const result =
                await blueskyService.useDomainHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-enabled',
            });
        });

        it('should return an error if the handle is not confirmed yet', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account, false);

            vi.mocked(bridgyFedClient.getBridgedDid).mockResolvedValue(
                error({ type: 'not-found' }),
            );

            const result =
                await blueskyService.useDomainHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-confirmed',
            });
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });
    });

    describe('checkDomainHandleForAccount', () => {
        const did = 'did:plc:bridged';

        let account: Account;
        let domain: string;
        let defaultHandle: string;

        beforeEach(async () => {
            [account] = await fixtureManager.createInternalAccount();
            domain = account.apId.hostname;
            defaultHandle = `${account.username}.${domain}.ap.brid.gy`;

            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([]),
            );
        });

        async function getRow() {
            return client('bluesky_integration_account_handles')
                .where('account_id', account.id)
                .first();
        }

        it('should report a domain that serves the DID to a check as reachable', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                { did },
            );

            vi.mocked(atprotoHandleResolver.resolveHttps).mockResolvedValue(
                did,
            );

            const result =
                await blueskyService.checkDomainHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                domain,
                reachable: true,
            });
            expect(atprotoHandleResolver.resolveHttps).toHaveBeenCalledWith(
                domain,
                { check: true },
            );
        });

        it.each([
            ['nothing', null],
            ['another DID', 'did:plc:someoneelse'],
        ])(
            'should report a domain that serves %s as not reachable',
            async (_served, servedDid) => {
                await fixtureManager.enableBlueskyIntegration(
                    account,
                    true,
                    defaultHandle,
                    { did },
                );

                vi.mocked(atprotoHandleResolver.resolveHttps).mockResolvedValue(
                    servedDid,
                );

                const result =
                    await blueskyService.checkDomainHandleForAccount(account);

                expect(getValue(result as Ok<unknown>)).toEqual({
                    domain,
                    reachable: false,
                });
            },
        );

        it('should report a domain whose DNS points at the account as reachable', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                { did },
            );

            vi.mocked(atprotoHandleResolver.resolveHttps).mockResolvedValue(
                null,
            );
            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([did]),
            );

            const result =
                await blueskyService.checkDomainHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                domain,
                reachable: true,
            });
        });

        it('should report a domain whose DNS cannot be checked as not reachable', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                { did },
            );

            vi.mocked(atprotoHandleResolver.resolveHttps).mockResolvedValue(
                null,
            );
            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                error({ type: 'dns-error', code: 'ESERVFAIL' }),
            );

            const result =
                await blueskyService.checkDomainHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                domain,
                reachable: false,
            });
        });

        it('should check again whatever an earlier claim found, without changing it', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'unavailable',
                    domain_handle_reason: 'not_reachable',
                },
            );

            vi.mocked(atprotoHandleResolver.resolveHttps).mockResolvedValue(
                did,
            );

            const result =
                await blueskyService.checkDomainHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                domain,
                reachable: true,
            });
            expect(await getRow()).toMatchObject({
                domain_handle: domain,
                domain_handle_status: 'unavailable',
                domain_handle_reason: 'not_reachable',
            });
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should find the DID of an account that enabled Bluesky sharing before domain handles existed', async () => {
            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                defaultHandle,
            );

            vi.mocked(bridgyFedClient.getBridgedDid).mockResolvedValue(ok(did));
            vi.mocked(blueskyApiClient.getProfile).mockResolvedValue(
                ok({ did, handle: defaultHandle }),
            );
            vi.mocked(atprotoHandleResolver.resolveHttps).mockResolvedValue(
                did,
            );

            const result =
                await blueskyService.checkDomainHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                domain,
                reachable: true,
            });
            expect(await getRow()).toMatchObject({
                did,
                domain_handle_status: null,
            });
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should return an error if the Bluesky integration is not enabled', async () => {
            const result =
                await blueskyService.checkDomainHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-enabled',
            });
        });

        it('should return an error if the handle is not confirmed yet', async () => {
            await fixtureManager.enableBlueskyIntegration(account, false);

            vi.mocked(bridgyFedClient.getBridgedDid).mockResolvedValue(
                error({ type: 'not-found' }),
            );

            const result =
                await blueskyService.checkDomainHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-confirmed',
            });
            expect(atprotoHandleResolver.resolveHttps).not.toHaveBeenCalled();
        });
    });

    describe('getDomainHandleDidForCheck', () => {
        const did = 'did:plc:bridged';

        it.each(['claiming', 'active', 'unavailable', 'released', null])(
            'should serve the DID whatever the domain handle status: %s',
            async (status) => {
                const [account] = await fixtureManager.createInternalAccount();

                await fixtureManager.enableBlueskyIntegration(
                    account,
                    true,
                    'index.example.com.ap.brid.gy',
                    {
                        did,
                        domain_handle: status ? account.apId.hostname : null,
                        domain_handle_status: status,
                    },
                );

                expect(
                    await blueskyService.getDomainHandleDidForCheck(account),
                ).toBe(did);
            },
        );

        it('should only serve the DID for a domain the account would claim when asked for a domain', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                'index.example.com.ap.brid.gy',
                { did },
            );

            expect(
                await blueskyService.getDomainHandleDidForCheck(
                    account,
                    account.apId.hostname.toUpperCase(),
                ),
            ).toBe(did);
            expect(
                await blueskyService.getDomainHandleDidForCheck(
                    account,
                    'someone-else.example',
                ),
            ).toBeNull();
        });

        it('should not serve a DID that is not known yet', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(account, false);

            expect(
                await blueskyService.getDomainHandleDidForCheck(account),
            ).toBeNull();
        });

        it('should not serve a DID when the Bluesky integration is not enabled', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            expect(
                await blueskyService.getDomainHandleDidForCheck(account),
            ).toBeNull();
        });
    });

    describe('getDomainHandleDid', () => {
        const did = 'did:plc:bridged';

        it.each([
            ['claiming', did],
            ['active', did],
            ['unavailable', null],
            ['released', null],
            [null, null],
        ])(
            'should serve the DID when the domain handle is %s: %s',
            async (status, expected) => {
                const [account] = await fixtureManager.createInternalAccount();

                await fixtureManager.enableBlueskyIntegration(
                    account,
                    true,
                    'index.example.com.ap.brid.gy',
                    {
                        did,
                        domain_handle: status ? account.apId.hostname : null,
                        domain_handle_status: status,
                    },
                );

                expect(await blueskyService.getDomainHandleDid(account)).toBe(
                    expected,
                );
            },
        );

        it('should not serve a DID when the Bluesky integration is not enabled', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            expect(await blueskyService.getDomainHandleDid(account)).toBeNull();
        });
    });
});
