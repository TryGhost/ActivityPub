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
import type { BridgyFedClient } from '@/integration/bridgy-fed.client';
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
    let bridgyFedClient: BridgyFedClient;
    let atprotoHandleResolver: AtprotoHandleResolver;
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
                domainHandle: null,
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
                domainHandle: { domain, status: 'active', reason: null },
            });

            expect(bridgyFedClient.getBridgedDid).not.toHaveBeenCalled();
            expect(blueskyApiClient.getProfile).not.toHaveBeenCalled();
        });

        it('should return an unconfirmed status while the account is not bridged yet', async () => {
            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle: defaultHandle,
                domainHandle: { domain, status: 'claiming', reason: null },
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
            await fixtureManager.enableBlueskyIntegration(account, false);

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

        it('should claim the domain handle for an account confirmed before domain handles existed', async () => {
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
            ).toEqual({ domain, status: 'claiming', reason: null });

            expect(await getSentDms()).toEqual([`username ${domain}`]);
        });

        it('should not claim a domain that points at another account in DNS', async () => {
            await fixtureManager.enableBlueskyIntegration(account, false);

            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([otherDid]),
            );

            const result =
                await blueskyService.confirmHandleForAccount(account);

            expect(
                (getValue(result as Ok<unknown>) as { domainHandle: unknown })
                    .domainHandle,
            ).toEqual({ domain, status: 'unavailable', reason: 'taken' });

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(atprotoHandleResolver.resolveHttps).not.toHaveBeenCalled();
            expect(await blueskyService.getDomainHandleDid(account)).toBeNull();
        });

        it('should not claim a domain with DNS records for several accounts', async () => {
            await fixtureManager.enableBlueskyIntegration(account, false);

            vi.mocked(atprotoHandleResolver.resolveDns).mockResolvedValue(
                ok([did, otherDid]),
            );

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_reason).toBe('taken');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not claim a domain that serves another account over HTTPS', async () => {
            await fixtureManager.enableBlueskyIntegration(account, false);

            vi.mocked(atprotoHandleResolver.resolveHttps)
                .mockReset()
                .mockResolvedValue(otherDid);

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).domain_handle_reason).toBe('taken');
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });

        it('should not claim a domain when its DNS cannot be checked', async () => {
            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

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

            await fixtureManager.enableBlueskyIntegration(account, false);

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

            await fixtureManager.enableBlueskyIntegration(account, false);

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
            await fixtureManager.enableBlueskyIntegration(account, false);

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
                domainHandle: { domain, status: 'active', reason: null },
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

        it('should claim the domain handle again after it was released', async () => {
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

            expect((await getRow()).domain_handle_status).toBe('claiming');
            expect(await getSentDms()).toEqual([`username ${domain}`]);
        });

        it('should take the handle over from another row that still has it', async () => {
            const [otherAccount] = await fixtureManager.createInternalAccount();

            await fixtureManager.enableBlueskyIntegration(
                otherAccount,
                true,
                defaultHandle,
            );
            await fixtureManager.enableBlueskyIntegration(account, false);

            await blueskyService.confirmHandleForAccount(account);

            expect((await getRow()).handle).toBe(defaultHandle);

            const otherRow = await client('bluesky_integration_account_handles')
                .where('account_id', otherAccount.id)
                .first();
            expect(otherRow.handle).toBeNull();
        });

        it('should leave the domain handle untried when the message cannot be sent', async () => {
            await fixtureManager.enableBlueskyIntegration(account, false);

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

    describe('retryDomainHandleForAccount', () => {
        const did = 'did:plc:bridged';

        it('should claim the domain handle again', async () => {
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
                await blueskyService.retryDomainHandleForAccount(account);

            expect(getValue(result as Ok<unknown>)).toEqual({
                handleConfirmed: true,
                handle: 'index.example.com.ap.brid.gy',
                domainHandle: { domain, status: 'claiming', reason: null },
            });
            expect(fedifyContext.sendActivity).toHaveBeenCalledTimes(1);
        });

        it('should return an error if the Bluesky integration is not enabled', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const result =
                await blueskyService.retryDomainHandleForAccount(account);

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
                await blueskyService.retryDomainHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-confirmed',
            });
            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
        });
    });

    describe('useDefaultHandleForAccount', () => {
        const did = 'did:plc:bridged';

        it('should switch back to the default handle', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const domain = account.apId.hostname;

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
                await blueskyService.useDefaultHandleForAccount(account);

            expect(
                (getValue(result as Ok<unknown>) as { domainHandle: unknown })
                    .domainHandle,
            ).toEqual({ domain, status: 'opted_out', reason: null });

            const create = vi.mocked(fedifyContext.sendActivity).mock
                .calls[0][2] as Create;
            const note = await create.getObject();

            expect(note!.content).toBe(
                `username ${account.username.toLowerCase().replace(/[_~]/g, '-')}.${domain}.ap.brid.gy`,
            );
            expect(await blueskyService.getDomainHandleDid(account)).toBeNull();
        });

        it('should not message brid.gy when the domain handle is not in use', async () => {
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
                    domain_handle_reason: 'taken',
                },
            );

            await blueskyService.useDefaultHandleForAccount(account);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();

            const row = await client('bluesky_integration_account_handles')
                .where('account_id', account.id)
                .first();
            expect(row.domain_handle_status).toBe('opted_out');
            expect(row.domain_handle_reason).toBeNull();
        });

        it('should not claim the domain handle again on confirmation after opting out', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const domain = account.apId.hostname;

            await fixtureManager.enableBlueskyIntegration(
                account,
                true,
                'index.example.com.ap.brid.gy',
                {
                    did,
                    domain_handle: domain,
                    domain_handle_status: 'opted_out',
                },
            );

            await blueskyService.confirmHandleForAccount(account);

            expect(fedifyContext.sendActivity).not.toHaveBeenCalled();
            expect(atprotoHandleResolver.resolveDns).not.toHaveBeenCalled();
        });

        it('should return an error if the Bluesky integration is not enabled', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const result =
                await blueskyService.useDefaultHandleForAccount(account);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-enabled',
            });
        });
    });

    describe('getDomainHandleDid', () => {
        const did = 'did:plc:bridged';

        it.each([
            ['claiming', did],
            ['active', did],
            ['unavailable', null],
            ['opted_out', null],
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
