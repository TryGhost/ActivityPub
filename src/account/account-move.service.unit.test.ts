import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Move, Note, Person } from '@fedify/vocab';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountMoveService } from '@/account/account-move.service';
import type { MoveHandler } from '@/activity-handlers/move.handler';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FedifyContext } from '@/app';
import { error, getError, getValue, isError, ok } from '@/core/result';
import { lookupActorProfile, lookupObject } from '@/lookup-helpers';

vi.mock('@/lookup-helpers', () => ({
    lookupActorProfile: vi.fn(),
    lookupObject: vi.fn(),
}));

describe('AccountMoveService', () => {
    const source = new URL(
        'https://example.com/.ghost/activitypub/users/index',
    );
    const target = new URL('https://mastodon.social/users/bryan');
    const moveId = new URL('https://example.com/.ghost/activitypub/moves/one');
    const account = {
        id: 1,
        username: 'index',
        apId: source,
        apFollowers: new URL(`${source.href}/followers`),
        isInternal: true,
    } as Account;

    let repository: KnexAccountRepository;
    let context: FedifyContext;
    let moveHandler: MoveHandler;
    let service: AccountMoveService;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(lookupActorProfile).mockResolvedValue(ok(target));
        vi.mocked(lookupObject).mockResolvedValue(
            new Person({ id: target, aliases: [source] }),
        );
        repository = {
            claimMove: vi
                .fn()
                .mockResolvedValue({ token: 'claim-one', activityId: moveId }),
            getMoveActivityId: vi.fn().mockResolvedValue(moveId),
            completeMove: vi.fn().mockResolvedValue(true),
            releaseMove: vi.fn().mockResolvedValue(undefined),
            getMove: vi.fn().mockResolvedValue(null),
        } as unknown as KnexAccountRepository;
        context = {
            getObjectUri: vi.fn().mockReturnValue(moveId),
            sendActivity: vi.fn().mockResolvedValue(undefined),
            data: { globaldb: { set: vi.fn().mockResolvedValue(undefined) } },
        } as unknown as FedifyContext;
        moveHandler = {
            migrateInternalFollowers: vi.fn().mockResolvedValue(undefined),
        } as unknown as MoveHandler;
        service = new AccountMoveService(
            repository,
            {
                getFedifyContext: () => context,
            } as FedifyContextFactory,
            moveHandler,
        );
    });

    it('sends a stable Move from the source to its followers', async () => {
        const result = await service.move(account, '@bryan@mastodon.social');
        expect(isError(result)).toBe(false);
        if (isError(result)) throw new Error('Expected migration to succeed');
        expect(getValue(result).target.href).toBe(target.href);
        expect(moveHandler.migrateInternalFollowers).toHaveBeenCalledOnce();
        expect(moveHandler.migrateInternalFollowers).toHaveBeenCalledWith(
            context,
            account,
            expect.any(Person),
        );
        const migratedTarget = vi.mocked(moveHandler.migrateInternalFollowers)
            .mock.calls[0][2] as Person;
        expect(migratedTarget.id?.href).toBe(target.href);
        expect(
            vi.mocked(moveHandler.migrateInternalFollowers).mock
                .invocationCallOrder[0],
        ).toBeLessThan(
            vi.mocked(context.sendActivity).mock.invocationCallOrder[0],
        );
        const sent = vi.mocked(context.sendActivity).mock.calls[0];
        expect(sent[0]).toEqual({ username: 'index' });
        expect(sent[1]).toBe('followers');
        expect(sent[2]).toBeInstanceOf(Move);
        const move = sent[2] as Move;
        expect(move.id?.href).toBe(moveId.href);
        expect(move.actorId?.href).toBe(source.href);
        expect(move.objectId?.href).toBe(source.href);
        expect(move.targetId?.href).toBe(target.href);
        expect(repository.completeMove).toHaveBeenCalledWith(1, 'claim-one');
    });

    it('keeps the handle that resolved, since actor URLs may hold internal IDs', async () => {
        const misskeyTarget = new URL('https://misskey.io/users/9h5x0a1b2c');
        vi.mocked(lookupActorProfile).mockResolvedValue(ok(misskeyTarget));
        vi.mocked(lookupObject).mockResolvedValue(
            new Person({ id: misskeyTarget, aliases: [source] }),
        );

        const result = await service.move(account, '@Louis@MissKey.io');

        if (isError(result)) throw new Error('Expected migration to succeed');
        expect(getValue(result)).toEqual({
            target: misskeyTarget,
            targetHandle: '@Louis@misskey.io',
        });
        expect(repository.claimMove).toHaveBeenCalledWith(
            1,
            misskeyTarget,
            '@Louis@misskey.io',
            moveId,
        );
    });

    it('rejects a destination that resolves to this account', async () => {
        vi.mocked(lookupActorProfile).mockResolvedValue(ok(source));
        const result = await service.move(account, '@index@example.com');
        if (!isError(result)) throw new Error('Expected migration to fail');
        expect(getError(result)).toEqual({ type: 'self-move' });
        expect(lookupObject).not.toHaveBeenCalled();
        expect(repository.claimMove).not.toHaveBeenCalled();
    });

    it.each([
        { case: 'a malformed handle', handle: 'bryan', isInternal: true },
        {
            case: 'an external account',
            handle: '@bryan@mastodon.social',
            isInternal: false,
        },
    ])(
        'rejects $case without looking it up',
        async ({ handle, isInternal }) => {
            const result = await service.move(
                { ...account, isInternal },
                handle,
            );
            if (!isError(result)) throw new Error('Expected migration to fail');
            expect(getError(result)).toEqual({ type: 'invalid-handle' });
            expect(lookupActorProfile).not.toHaveBeenCalled();
        },
    );

    it.each([
        {
            case: 'the handle does not resolve',
            arrange: () =>
                vi
                    .mocked(lookupActorProfile)
                    .mockResolvedValue(error('lookup-error')),
        },
        {
            case: 'the actor cannot be fetched',
            arrange: () =>
                vi
                    .mocked(lookupObject)
                    .mockRejectedValue(new Error('fetch failed')),
        },
        {
            case: 'the handle resolves to something other than an actor',
            arrange: () =>
                vi
                    .mocked(lookupObject)
                    .mockResolvedValue(new Note({ id: target })),
        },
        {
            case: 'the fetched actor has a different ID',
            arrange: () =>
                vi.mocked(lookupObject).mockResolvedValue(
                    new Person({
                        id: new URL('https://evil.example/users/bryan'),
                        aliases: [source],
                    }),
                ),
        },
    ])(
        'reports the destination as unavailable when $case',
        async ({ arrange }) => {
            arrange();
            const result = await service.move(
                account,
                '@bryan@mastodon.social',
            );
            if (!isError(result)) throw new Error('Expected migration to fail');
            expect(getError(result)).toEqual({ type: 'target-unavailable' });
            expect(repository.claimMove).not.toHaveBeenCalled();
        },
    );

    it('requires the destination actor to alias the source', async () => {
        vi.mocked(lookupObject).mockResolvedValue(new Person({ id: target }));
        const result = await service.move(account, '@bryan@mastodon.social');
        expect(isError(result)).toBe(true);
        if (!isError(result)) throw new Error('Expected migration to fail');
        expect(getError(result)).toEqual({ type: 'alias-required' });
        expect(repository.claimMove).not.toHaveBeenCalled();
        expect(context.sendActivity).not.toHaveBeenCalled();
    });

    it('does not send a duplicate Move when already sent', async () => {
        vi.mocked(repository.claimMove).mockResolvedValue('sent');
        await service.move(account, '@bryan@mastodon.social');
        expect(moveHandler.migrateInternalFollowers).not.toHaveBeenCalled();
        expect(context.sendActivity).not.toHaveBeenCalled();
    });

    it('releases a failed delivery for retry', async () => {
        vi.mocked(context.sendActivity).mockRejectedValue(
            new Error('queue unavailable'),
        );
        await expect(
            service.move(account, '@bryan@mastodon.social'),
        ).rejects.toThrow('queue unavailable');
        expect(moveHandler.migrateInternalFollowers).toHaveBeenCalledOnce();
        expect(repository.releaseMove).toHaveBeenCalledWith(1, 'claim-one');
        expect(repository.completeMove).not.toHaveBeenCalled();
    });

    it('releases the claim when internal follower migration fails', async () => {
        vi.mocked(moveHandler.migrateInternalFollowers).mockRejectedValue(
            new Error('migration failed'),
        );
        await expect(
            service.move(account, '@bryan@mastodon.social'),
        ).rejects.toThrow('migration failed');
        expect(context.sendActivity).not.toHaveBeenCalled();
        expect(repository.releaseMove).toHaveBeenCalledWith(1, 'claim-one');
        expect(repository.completeMove).not.toHaveBeenCalled();
    });

    it('keeps the claim when completion fails after the Move was queued', async () => {
        vi.mocked(repository.completeMove).mockRejectedValue(
            new Error('database unavailable'),
        );
        await expect(
            service.move(account, '@bryan@mastodon.social'),
        ).rejects.toThrow('database unavailable');
        expect(context.sendActivity).toHaveBeenCalledTimes(1);
        expect(repository.releaseMove).not.toHaveBeenCalled();
    });

    it('does not report success when a newer request owns the claim', async () => {
        vi.mocked(repository.completeMove).mockResolvedValue(false);
        const result = await service.move(account, '@bryan@mastodon.social');
        expect(isError(result)).toBe(true);
        if (!isError(result)) throw new Error('Expected a busy result');
        expect(getError(result)).toEqual({ type: 'busy' });
        expect(repository.releaseMove).not.toHaveBeenCalled();
    });

    it('rejects a different destination once migration has begun', async () => {
        vi.mocked(repository.claimMove).mockResolvedValue('different-target');
        const result = await service.move(account, '@bryan@mastodon.social');
        if (!isError(result)) throw new Error('Expected migration to fail');
        expect(getError(result)).toEqual({ type: 'different-target' });
        expect(context.sendActivity).not.toHaveBeenCalled();
    });
});
