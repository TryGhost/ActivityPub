import { isActor, Move, PUBLIC_COLLECTION } from '@fedify/vocab';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { error, getValue, isError, ok, type Result } from '@/core/result';
import { isHandle } from '@/helpers/activitypub/actor';
import { lookupActorProfile, lookupObject } from '@/lookup-helpers';

type MoveError =
    | { type: 'invalid-handle' }
    | { type: 'target-unavailable' }
    | { type: 'alias-required' }
    | { type: 'self-move' }
    | { type: 'different-target' }
    | { type: 'busy' };

export class AccountMoveService {
    constructor(
        private readonly accountRepository: KnexAccountRepository,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async move(
        account: Account,
        targetHandle: string,
    ): Promise<Result<{ target: URL }, MoveError>> {
        if (!account.isInternal || !isHandle(targetHandle)) {
            return error({ type: 'invalid-handle' });
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();
        const lookup = await lookupActorProfile(ctx, targetHandle);
        if (isError(lookup)) return error({ type: 'target-unavailable' });

        const targetId = getValue(lookup);
        if (targetId.href === account.apId.href) {
            return error({ type: 'self-move' });
        }

        // Fetch the destination actor before emitting Move. A destination must
        // explicitly list the source in alsoKnownAs to prove reciprocal control.
        let target: unknown;
        try {
            target = await lookupObject(ctx, targetId);
        } catch (_err) {
            return error({ type: 'target-unavailable' });
        }
        if (!isActor(target) || target.id?.href !== targetId.href) {
            return error({ type: 'target-unavailable' });
        }
        if (
            !Array.from(target.aliasIds).some(
                (alias) => alias.href === account.apId.href,
            )
        ) {
            return error({ type: 'alias-required' });
        }

        const claim = await this.accountRepository.claimMove(
            account.id,
            targetId,
            ctx.getObjectUri(Move, { id: uuidv4() }),
        );
        if (claim === 'different-target') {
            return error({ type: 'different-target' });
        }
        if (claim === 'busy') return error({ type: 'busy' });
        if (claim === 'sent') return ok({ target: targetId });

        const move = new Move({
            id: await this.accountRepository.getMoveActivityId(account.id),
            actor: account.apId,
            object: account.apId,
            target: targetId,
            to: PUBLIC_COLLECTION,
            cc: account.apFollowers,
        });

        try {
            await ctx.data.globaldb.set([move.id!.href], await move.toJsonLd());
            await ctx.sendActivity(
                { username: account.username },
                'followers',
                move,
                { preferSharedInbox: true },
            );
            await this.accountRepository.completeMove(account.id);
        } catch (err) {
            await this.accountRepository.releaseMove(account.id);
            throw err;
        }

        return ok({ target: targetId });
    }

    async getMove(accountId: number) {
        return this.accountRepository.getMove(accountId);
    }
}
