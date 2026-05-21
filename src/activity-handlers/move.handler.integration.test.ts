import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { lookupObject, Move, Person } from '@fedify/fedify';
import type { Knex } from 'knex';

import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FedifyContext } from '@/app';
import { AsyncEvents } from '@/core/events';
import { ModerationService } from '@/moderation/moderation.service';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';
import { MoveHandler } from './move.handler';

vi.mock('@fedify/fedify', async (importOriginal) => {
    const original = await importOriginal<typeof import('@fedify/fedify')>();

    return {
        ...original,
        lookupObject: vi.fn(),
    };
});

describe('MoveHandler', () => {
    let db: Knex;
    let events: AsyncEvents;
    let fixtureManager: FixtureManager;
    let handler: MoveHandler;
    let ctx: FedifyContext;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
    });

    afterEach(() => {
        events.removeAllListeners();
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = {
            getFedifyContext: () => ({
                getDocumentLoader: async () => ({}),
            }),
        } as unknown as FedifyContextFactory;
        const accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        const moderationService = new ModerationService(db);

        handler = new MoveHandler(accountService, moderationService);

        ctx = {
            data: {
                globaldb: {
                    set: async () => undefined,
                },
                logger: {
                    debug: () => undefined,
                    warn: () => undefined,
                },
            },
            getObjectUri: (klass: { name: string }, data: { id: string }) => {
                return new URL(
                    `https://ghost.example/.ghost/activitypub/${klass.name.toLowerCase()}/${data.id}`,
                );
            },
            getDocumentLoader: async () => ({}),
            sendActivity: async () => undefined,
        } as unknown as FedifyContext;
    });

    it('moves an internal follower from the old remote actor to the new remote actor', async () => {
        const [follower] = await fixtureManager.createInternalAccount();
        const oldAccount = await fixtureManager.createExternalAccount(
            'https://mastodon.example/users/',
        );
        const newAccount = await fixtureManager.createExternalAccount(
            'https://new.example/users/',
        );

        await fixtureManager.createFollow(follower, oldAccount);

        const oldActor = new Person({
            id: oldAccount.apId,
            inbox: oldAccount.apInbox,
            preferredUsername: oldAccount.username,
        });
        const newActor = new Person({
            id: newAccount.apId,
            inbox: newAccount.apInbox,
            preferredUsername: newAccount.username,
            aliases: [oldAccount.apId],
        });
        vi.mocked(lookupObject).mockResolvedValue(newActor);

        await handler.handle(
            ctx,
            new Move({
                id: new URL(`${oldAccount.apId.href}#moves/1`),
                actor: oldActor,
                object: oldActor,
                target: newActor,
            }),
        );

        await expect(
            db('follows')
                .where({
                    follower_id: follower.id,
                    following_id: oldAccount.id,
                })
                .first(),
        ).resolves.toBeUndefined();

        await expect(
            db('follows')
                .where({
                    follower_id: follower.id,
                    following_id: newAccount.id,
                })
                .first(),
        ).resolves.toMatchObject({
            follower_id: follower.id,
            following_id: newAccount.id,
        });
    });
});
