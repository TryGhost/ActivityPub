import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Move, Person } from '@fedify/vocab';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountMoveService } from '@/account/account-move.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FedifyContext } from '@/app';
import { getError, getValue, isError, ok } from '@/core/result';
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
    let service: AccountMoveService;

    beforeEach(() => {
        vi.mocked(lookupActorProfile).mockResolvedValue(ok(target));
        vi.mocked(lookupObject).mockResolvedValue(
            new Person({ id: target, aliases: [source] }),
        );
        repository = {
            claimMove: vi.fn().mockResolvedValue('claimed'),
            getMoveActivityId: vi.fn().mockResolvedValue(moveId),
            completeMove: vi.fn().mockResolvedValue(undefined),
            releaseMove: vi.fn().mockResolvedValue(undefined),
            getMove: vi.fn().mockResolvedValue(null),
        } as unknown as KnexAccountRepository;
        context = {
            getObjectUri: vi.fn().mockReturnValue(moveId),
            sendActivity: vi.fn().mockResolvedValue(undefined),
            data: { globaldb: { set: vi.fn().mockResolvedValue(undefined) } },
        } as unknown as FedifyContext;
        service = new AccountMoveService(repository, {
            getFedifyContext: () => context,
        } as FedifyContextFactory);
    });

    it('sends a stable Move from the source to its followers', async () => {
        const result = await service.move(account, '@bryan@mastodon.social');
        expect(isError(result)).toBe(false);
        if (isError(result)) throw new Error('Expected migration to succeed');
        expect(getValue(result).target.href).toBe(target.href);
        const sent = vi.mocked(context.sendActivity).mock.calls[0];
        expect(sent[0]).toEqual({ username: 'index' });
        expect(sent[1]).toBe('followers');
        expect(sent[2]).toBeInstanceOf(Move);
        const move = sent[2] as Move;
        expect(move.id?.href).toBe(moveId.href);
        expect(move.actorId?.href).toBe(source.href);
        expect(move.objectId?.href).toBe(source.href);
        expect(move.targetId?.href).toBe(target.href);
        expect(repository.completeMove).toHaveBeenCalledWith(1);
    });

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
        expect(context.sendActivity).not.toHaveBeenCalled();
    });

    it('releases a failed delivery for retry', async () => {
        vi.mocked(context.sendActivity).mockRejectedValue(
            new Error('queue unavailable'),
        );
        await expect(
            service.move(account, '@bryan@mastodon.social'),
        ).rejects.toThrow('queue unavailable');
        expect(repository.releaseMove).toHaveBeenCalledWith(1);
        expect(repository.completeMove).not.toHaveBeenCalled();
    });

    it('rejects a different destination once migration has begun', async () => {
        vi.mocked(repository.claimMove).mockResolvedValue('different-target');
        const result = await service.move(account, '@bryan@mastodon.social');
        if (!isError(result)) throw new Error('Expected migration to fail');
        expect(getError(result)).toEqual({ type: 'different-target' });
        expect(context.sendActivity).not.toHaveBeenCalled();
    });
});
