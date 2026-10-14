import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { lookupObject, Move, Person } from '@fedify/vocab';
import type { Knex } from 'knex';

import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import { AccountMoveService } from '@/account/account-move.service';
import { MoveHandler } from '@/activity-handlers/move.handler';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FedifyContext } from '@/app';
import { AsyncEvents } from '@/core/events';
import { getValue, isError, ok } from '@/core/result';
import {
    lookupActorProfile,
    lookupObject as lookupHelpersObject,
} from '@/lookup-helpers';
import { ModerationService } from '@/moderation/moderation.service';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

vi.mock('@fedify/vocab', async (importOriginal) => {
    const original = await importOriginal<typeof import('@fedify/vocab')>();

    return {
        ...original,
        lookupObject: vi.fn(),
    };
});

vi.mock('@/lookup-helpers', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lookup-helpers')>();

    return {
        ...original,
        lookupActorProfile: vi.fn(),
        lookupObject: vi.fn(),
    };
});

describe('AccountMoveService Ghost→Ghost same instance', () => {
    let db: Knex;
    let events: AsyncEvents;
    let fixtureManager: FixtureManager;
    let accountRepository: KnexAccountRepository;
    let accountService: AccountService;
    let service: AccountMoveService;
    let ctx: FedifyContext;
    let sendActivity: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
    });

    afterEach(() => {
        events.removeAllListeners();
    });

    beforeEach(async () => {
        await fixtureManager.reset();
        vi.clearAllMocks();

        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = {
            getFedifyContext: () => ctx,
        } as unknown as FedifyContextFactory;
        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        const moderationService = new ModerationService(db);
        const moveHandler = new MoveHandler(accountService, moderationService);

        sendActivity = vi.fn().mockResolvedValue(undefined);
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
                    `https://source.test/.ghost/activitypub/${klass.name.toLowerCase()}/${data.id}`,
                );
            },
            getDocumentLoader: async () => ({}),
            sendActivity,
        } as unknown as FedifyContext;

        service = new AccountMoveService(
            accountRepository,
            fedifyContextFactory,
            moveHandler,
        );
    });

    it('migrates same-instance followers in-process without relying on Move inbox delivery', async () => {
        const [source] = await fixtureManager.createInternalAccount(
            null,
            'source.test',
        );
        const [target] = await fixtureManager.createInternalAccount(
            null,
            'target.test',
        );
        const [follower] = await fixtureManager.createInternalAccount(
            null,
            'follower.test',
        );

        await fixtureManager.createFollow(follower, source);
        await accountRepository.save(target.addAlias(source.apId));

        const targetActor = new Person({
            id: target.apId,
            inbox: target.apInbox,
            preferredUsername: target.username,
            aliases: [source.apId],
        });

        vi.mocked(lookupActorProfile).mockResolvedValue(ok(target.apId));
        vi.mocked(lookupHelpersObject).mockResolvedValue(targetActor);
        vi.mocked(lookupObject).mockResolvedValue(targetActor);

        const result = await service.move(
            source,
            `@${target.username}@target.test`,
        );

        expect(isError(result)).toBe(false);
        if (isError(result)) {
            throw new Error('Expected migration to succeed');
        }
        expect(getValue(result).target.href).toBe(target.apId.href);

        expect(sendActivity).toHaveBeenCalledOnce();
        expect(sendActivity).toHaveBeenCalledWith(
            { username: source.username },
            'followers',
            expect.any(Move),
            { preferSharedInbox: true },
        );

        await expect(
            db('follows')
                .where({
                    follower_id: follower.id,
                    following_id: source.id,
                })
                .first(),
        ).resolves.toBeUndefined();

        await expect(
            db('follows')
                .where({
                    follower_id: follower.id,
                    following_id: target.id,
                })
                .first(),
        ).resolves.toMatchObject({
            follower_id: follower.id,
            following_id: target.id,
        });
    });
});
