import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Follow, lookupObject, Move, Person, Undo } from '@fedify/fedify';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { FedifyContext } from '@/app';
import { error, ok } from '@/core/result';
import type { ModerationService } from '@/moderation/moderation.service';
import {
    createTestExternalAccount,
    createTestInternalAccount,
} from '@/test/account-entity-test-helpers';
import { MoveHandler } from './move.handler';

vi.mock('@fedify/fedify', async (importOriginal) => {
    const original = await importOriginal<typeof import('@fedify/fedify')>();

    return {
        ...original,
        lookupObject: vi.fn(),
    };
});

describe('MoveHandler', () => {
    let handler: MoveHandler;
    let accountService: {
        getAccountByApId: ReturnType<typeof vi.fn>;
        getAccountById: ReturnType<typeof vi.fn>;
        ensureByApId: ReturnType<typeof vi.fn>;
        getInternalFollowerAccounts: ReturnType<typeof vi.fn>;
        checkIfAccountIsFollowing: ReturnType<typeof vi.fn>;
        followAccount: ReturnType<typeof vi.fn>;
        unfollowAccount: ReturnType<typeof vi.fn>;
    };
    let moderationService: {
        canFollowAccount: ReturnType<typeof vi.fn>;
    };
    let ctx: FedifyContext;
    let globaldb: {
        set: ReturnType<typeof vi.fn>;
    };
    let sourceAccount: Account;
    let targetAccount: Account;
    let followerAccount: Account;
    let sourceActor: Person;
    let targetActor: Person;

    beforeEach(async () => {
        globaldb = {
            set: vi.fn(),
        };

        ctx = {
            data: {
                globaldb,
                logger: {
                    debug: vi.fn(),
                    warn: vi.fn(),
                },
            },
            getObjectUri: vi.fn((klass, data) => {
                return new URL(
                    `https://ghost.example/.ghost/activitypub/${klass.name.toLowerCase()}/${data.id}`,
                );
            }),
            getDocumentLoader: vi.fn().mockResolvedValue({}),
            sendActivity: vi.fn(),
        } as unknown as FedifyContext;

        accountService = {
            getAccountByApId: vi.fn(),
            getAccountById: vi.fn(),
            ensureByApId: vi.fn(),
            getInternalFollowerAccounts: vi.fn(),
            checkIfAccountIsFollowing: vi.fn(),
            followAccount: vi.fn(),
            unfollowAccount: vi.fn(),
        };

        moderationService = {
            canFollowAccount: vi.fn().mockResolvedValue(true),
        };

        handler = new MoveHandler(
            accountService as unknown as AccountService,
            moderationService as unknown as ModerationService,
        );

        followerAccount = await createTestInternalAccount(1, {
            host: new URL('https://ghost.example'),
            username: 'index',
            name: 'Ghost',
            bio: null,
            url: null,
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
        });

        sourceAccount = await createTestExternalAccount(2, {
            username: 'old',
            name: 'Old account',
            bio: null,
            url: null,
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
            apId: new URL('https://mastodon.example/users/old'),
            apFollowers: null,
            apInbox: new URL('https://mastodon.example/users/old/inbox'),
        });

        targetAccount = await createTestExternalAccount(3, {
            username: 'new',
            name: 'New account',
            bio: null,
            url: null,
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
            apId: new URL('https://mastodon.example/users/new'),
            apFollowers: null,
            apInbox: new URL('https://mastodon.example/users/new/inbox'),
        });

        sourceActor = new Person({
            id: sourceAccount.apId,
            inbox: sourceAccount.apInbox,
            preferredUsername: sourceAccount.username,
        });

        targetActor = new Person({
            id: targetAccount.apId,
            inbox: targetAccount.apInbox,
            preferredUsername: targetAccount.username,
            aliases: [sourceAccount.apId],
        });

        vi.mocked(lookupObject).mockResolvedValue(targetActor);
        accountService.getAccountByApId.mockResolvedValue({
            id: sourceAccount.id,
        });
        accountService.getAccountById.mockResolvedValue(sourceAccount);
        accountService.ensureByApId.mockResolvedValue(ok(targetAccount));
        accountService.getInternalFollowerAccounts.mockResolvedValue([
            followerAccount,
        ]);
        accountService.checkIfAccountIsFollowing.mockResolvedValue(false);
    });

    function createMove(
        overrides: Partial<ConstructorParameters<typeof Move>[0]> = {},
    ) {
        return new Move({
            id: new URL('https://mastodon.example/users/old#moves/1'),
            actor: sourceActor,
            object: sourceActor,
            target: targetActor,
            ...overrides,
        });
    }

    it('ignores Move activities with missing required ids', async () => {
        for (const move of [
            { id: null },
            { id: createMove().id, actorId: null },
            {
                id: createMove().id,
                actorId: sourceAccount.apId,
                objectId: null,
            },
            {
                id: createMove().id,
                actorId: sourceAccount.apId,
                objectId: sourceAccount.apId,
                targetId: null,
            },
        ]) {
            await handler.handle(ctx, move as unknown as Move);
        }

        expect(accountService.getAccountByApId).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities where actor and object differ', async () => {
        await handler.handle(
            ctx,
            createMove({
                object: new URL('https://mastodon.example/users/someone-else'),
            }),
        );

        expect(accountService.getAccountByApId).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities when the source account is not known locally', async () => {
        accountService.getAccountByApId.mockResolvedValue(null);

        await handler.handle(ctx, createMove());

        expect(accountService.ensureByApId).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities when the target lookup fails', async () => {
        vi.mocked(lookupObject).mockRejectedValue(new Error('lookup failed'));

        await handler.handle(ctx, createMove());

        expect(accountService.ensureByApId).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities when the target account lookup fails', async () => {
        accountService.ensureByApId.mockResolvedValue(error('network-failure'));

        await handler.handle(ctx, createMove());

        expect(
            accountService.getInternalFollowerAccounts,
        ).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities when the target is not an actor', async () => {
        vi.mocked(lookupObject).mockResolvedValue({
            id: targetAccount.apId,
        } as never);

        await handler.handle(ctx, {
            id: createMove().id,
            actorId: sourceAccount.apId,
            objectId: sourceAccount.apId,
            targetId: targetAccount.apId,
        } as unknown as Move);

        expect(accountService.ensureByApId).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities when the target does not alias the source', async () => {
        targetActor = new Person({
            id: targetAccount.apId,
            inbox: targetAccount.apInbox,
            preferredUsername: targetAccount.username,
        });
        vi.mocked(lookupObject).mockResolvedValue(targetActor);

        await handler.handle(ctx, createMove({ target: targetActor }));

        expect(accountService.ensureByApId).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities when the target matches the source', async () => {
        await handler.handle(
            ctx,
            createMove({
                target: sourceActor,
            }),
        );

        expect(accountService.getAccountByApId).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores Move activities when there are no internal followers', async () => {
        accountService.getInternalFollowerAccounts.mockResolvedValue([]);

        await handler.handle(ctx, createMove());

        expect(accountService.unfollowAccount).not.toHaveBeenCalled();
        expect(accountService.followAccount).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('ignores followers that cannot interact with the target account', async () => {
        moderationService.canFollowAccount.mockResolvedValue(false);

        await handler.handle(ctx, createMove());

        expect(accountService.unfollowAccount).not.toHaveBeenCalled();
        expect(accountService.followAccount).not.toHaveBeenCalled();
        expect(ctx.sendActivity).not.toHaveBeenCalled();
    });

    it('unfollows the old account when already following the target', async () => {
        accountService.checkIfAccountIsFollowing.mockResolvedValue(true);

        await handler.handle(ctx, createMove());

        expect(ctx.sendActivity).toHaveBeenCalledOnce();
        expect(ctx.sendActivity).toHaveBeenCalledWith(
            { username: followerAccount.username },
            expect.objectContaining({ id: sourceAccount.apId }),
            expect.any(Undo),
        );

        expect(accountService.unfollowAccount).toHaveBeenCalledOnce();
        expect(accountService.unfollowAccount).toHaveBeenCalledWith(
            followerAccount,
            sourceAccount,
        );
        expect(accountService.followAccount).not.toHaveBeenCalled();
    });

    it('follows the target and unfollows the old account for a valid Move', async () => {
        await handler.handle(ctx, createMove());

        expect(ctx.sendActivity).toHaveBeenCalledTimes(2);
        expect(ctx.sendActivity).toHaveBeenNthCalledWith(
            1,
            { username: followerAccount.username },
            targetActor,
            expect.any(Follow),
        );
        expect(ctx.sendActivity).toHaveBeenNthCalledWith(
            2,
            { username: followerAccount.username },
            expect.objectContaining({ id: sourceAccount.apId }),
            expect.any(Undo),
        );

        expect(accountService.unfollowAccount).toHaveBeenCalledWith(
            followerAccount,
            sourceAccount,
        );
        expect(accountService.followAccount).toHaveBeenCalledWith(
            followerAccount,
            targetAccount,
        );
        expect(globaldb.set).toHaveBeenCalledWith(
            [createMove().id!.href],
            expect.any(Object),
        );
    });

    it('keeps the old follow when sending the target Follow fails', async () => {
        vi.mocked(ctx.sendActivity).mockRejectedValueOnce(
            new Error('send failed'),
        );

        await handler.handle(ctx, createMove());

        expect(accountService.unfollowAccount).not.toHaveBeenCalled();
        expect(accountService.followAccount).not.toHaveBeenCalled();
    });

    it('continues migrating later followers when one follower fails', async () => {
        const secondFollower = await createTestInternalAccount(4, {
            host: new URL('https://second.example'),
            username: 'index',
            name: 'Second',
            bio: null,
            url: null,
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
        });

        accountService.getInternalFollowerAccounts.mockResolvedValue([
            followerAccount,
            secondFollower,
        ]);
        vi.mocked(ctx.sendActivity)
            .mockRejectedValueOnce(new Error('send failed'))
            .mockResolvedValue(undefined);

        await handler.handle(ctx, createMove());

        expect(accountService.unfollowAccount).toHaveBeenCalledOnce();
        expect(accountService.unfollowAccount).toHaveBeenCalledWith(
            secondFollower,
            sourceAccount,
        );
        expect(accountService.followAccount).toHaveBeenCalledOnce();
        expect(accountService.followAccount).toHaveBeenCalledWith(
            secondFollower,
            targetAccount,
        );
    });

    it('ignores embedded target aliases when authoritative target does not alias the source', async () => {
        const embeddedTarget = new Person({
            id: targetAccount.apId,
            inbox: targetAccount.apInbox,
            preferredUsername: targetAccount.username,
            aliases: [sourceAccount.apId],
        });
        const fetchedTarget = new Person({
            id: targetAccount.apId,
            inbox: targetAccount.apInbox,
            preferredUsername: targetAccount.username,
        });
        vi.mocked(lookupObject).mockResolvedValue(fetchedTarget);

        await handler.handle(ctx, createMove({ target: embeddedTarget }));

        expect(accountService.ensureByApId).not.toHaveBeenCalled();
        expect(accountService.unfollowAccount).not.toHaveBeenCalled();
        expect(accountService.followAccount).not.toHaveBeenCalled();
    });
});
