import type { Logger } from '@logtape/logtape';
import { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import { AccountCreatedEvent } from 'account/events';
import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { GhostExploreService } from './ghost-explore.service';

async function createGhostExploreAccount(
    db: Knex,
    fixtureManager: FixtureManager,
) {
    const ghostExploreAccount = await fixtureManager.createExternalAccount(
        'https://mastodon.social/users/',
    );

    await db('accounts').where({ id: ghostExploreAccount.id }).update({
        username: 'ghostexplore',
        name: 'Ghost Explore',
        ap_id: 'https://mastodon.social/users/ghostexplore',
        ap_inbox_url: 'https://mastodon.social/users/ghostexplore/inbox',
        ap_outbox_url: 'https://mastodon.social/users/ghostexplore/outbox',
        ap_following_url:
            'https://mastodon.social/users/ghostexplore/following',
        ap_followers_url:
            'https://mastodon.social/users/ghostexplore/followers',
        ap_liked_url: 'https://mastodon.social/users/ghostexplore/liked',
        ap_shared_inbox_url: 'https://mastodon.social/inbox',
        url: 'https://mastodon.social/users/ghostexplore',
        domain: 'mastodon.social',
    });

    return ghostExploreAccount;
}

describe('GhostExploreService', () => {
    let service: GhostExploreService;
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;
    let accountService: AccountService;
    let logger: Logger;
    let db: Knex;
    let fixtureManager: FixtureManager;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        // Set up dependencies
        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(db, events);

        // Mock logger
        logger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as Logger;

        // Mock AccountService
        accountService = {
            followAccount: vi.fn().mockResolvedValue(undefined),
        } as unknown as AccountService;

        // Create the service
        service = new GhostExploreService(
            events,
            accountRepository,
            accountService,
            logger,
        );
    });

    afterEach(() => {
        events.removeAllListeners();
        vi.clearAllMocks();
    });

    describe('init', () => {
        it('should register event listener for AccountCreatedEvent', () => {
            const spy = vi.spyOn(events, 'on');

            service.init();

            expect(spy).toHaveBeenCalledWith(
                AccountCreatedEvent.getName(),
                expect.any(Function),
            );
        });
    });

    describe('followGhostExplore', () => {
        it('should follow Ghost Explore account for internal accounts', async () => {
            const ghostExploreAccount = await createGhostExploreAccount(
                db,
                fixtureManager,
            );

            // Create internal account
            const [internalAccount] =
                await fixtureManager.createInternalAccount();

            await service.followGhostExplore(internalAccount.id);

            expect(accountService.followAccount).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: internalAccount.id,
                    isInternal: true,
                }),
                expect.objectContaining({
                    id: ghostExploreAccount.id,
                    apId: expect.objectContaining({
                        href: 'https://mastodon.social/users/ghostexplore',
                    }),
                }),
            );

            expect(logger.info).toHaveBeenCalledWith(
                'Following Ghost Explore account for new account {apId}',
                expect.objectContaining({
                    apId: internalAccount.apId.href,
                }),
            );
        });

        it('should not follow Ghost Explore account for external accounts', async () => {
            await createGhostExploreAccount(db, fixtureManager);

            // Create external account
            const externalAccount =
                await fixtureManager.createExternalAccount();

            await service.followGhostExplore(externalAccount.id);

            expect(accountService.followAccount).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                'Not following Ghost Explore account for non-internal account {apId}',
                expect.objectContaining({
                    apId: externalAccount.apId.href,
                }),
            );
        });

        it('should log error when account is not found', async () => {
            const nonExistentId = 999999;

            await service.followGhostExplore(nonExistentId);

            expect(accountService.followAccount).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(
                'Could not find account {id} for account created event',
                expect.objectContaining({
                    id: nonExistentId,
                }),
            );
        });

        it('should log error when Ghost Explore account is not found', async () => {
            // Create internal account but no Ghost Explore account
            const [internalAccount] =
                await fixtureManager.createInternalAccount();

            await service.followGhostExplore(internalAccount.id);

            expect(accountService.followAccount).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(
                'Ghost Explore account not found',
            );
        });

        it('should handle AccountCreatedEvent', async () => {
            await createGhostExploreAccount(db, fixtureManager);

            // Create internal account
            const [internalAccount] =
                await fixtureManager.createInternalAccount();

            service.init();

            const event = new AccountCreatedEvent(internalAccount.id);
            await events.emitAsync(AccountCreatedEvent.getName(), event);

            expect(accountService.followAccount).toHaveBeenCalled();
        });
    });
});
