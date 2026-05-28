import {
    type Actor,
    Follow,
    isActor,
    lookupObject,
    type Move,
    Person,
    Undo,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { FedifyContext } from '@/app';
import { getValue, isError } from '@/core/result';
import type { ModerationService } from '@/moderation/moderation.service';

export class MoveHandler {
    constructor(
        private readonly accountService: AccountService,
        private readonly moderationService: ModerationService,
    ) {}

    async handle(ctx: FedifyContext, move: Move) {
        ctx.data.logger.debug('Handling Move');

        if (!move.id) {
            ctx.data.logger.debug('Move missing id, exit early');
            return;
        }

        if (!move.actorId) {
            ctx.data.logger.debug('Move missing actorId, exit early');
            return;
        }

        if (!move.objectId) {
            ctx.data.logger.debug('Move missing objectId, exit early');
            return;
        }

        if (!move.targetId) {
            ctx.data.logger.debug('Move missing targetId, exit early');
            return;
        }

        if (move.actorId.href !== move.objectId.href) {
            ctx.data.logger.debug('Move actor and object differ, exit early');
            return;
        }

        if (move.actorId.href === move.targetId.href) {
            ctx.data.logger.debug('Move target matches actor, exit early');
            return;
        }

        const sourceAccountRow = await this.accountService.getAccountByApId(
            move.actorId.href,
        );

        if (!sourceAccountRow) {
            ctx.data.logger.debug('Move source account not found, exit early');
            return;
        }

        const sourceAccount = await this.accountService.getAccountById(
            sourceAccountRow.id,
        );

        if (!sourceAccount) {
            ctx.data.logger.debug(
                'Move source account entity not found, exit early',
            );
            return;
        }

        const targetActor = await this.getTargetActor(ctx, move);

        if (!targetActor) {
            return;
        }

        const sourceActor = this.createSourceActor(sourceAccount);

        if (!this.targetAliasesSource(targetActor.aliasIds, move.actorId)) {
            ctx.data.logger.debug(
                'Move target does not alias source account, exit early',
            );
            return;
        }

        const targetAccountResult = await this.accountService.ensureByApId(
            targetActor.id!,
        );

        if (isError(targetAccountResult)) {
            ctx.data.logger.debug('Move target account not found, exit early');
            return;
        }

        const targetAccount = getValue(targetAccountResult);

        const followers =
            await this.accountService.getInternalFollowerAccounts(
                sourceAccount,
            );

        if (followers.length === 0) {
            ctx.data.logger.debug('Move source has no internal followers');
            return;
        }

        await this.persistActivity(ctx, move, targetActor);

        for (const follower of followers) {
            try {
                await this.moveFollower(
                    ctx,
                    follower,
                    sourceAccount,
                    targetAccount,
                    targetActor,
                    sourceActor,
                );
            } catch (err) {
                ctx.data.logger.warn('Failed to migrate follower during Move', {
                    error: err,
                    follower: follower.apId.href,
                    source: sourceAccount.apId.href,
                    target: targetAccount.apId.href,
                });
            }
        }
    }

    private targetAliasesSource(
        targetAliases: Iterable<URL>,
        sourceApId: URL,
    ): boolean {
        return Array.from(targetAliases).some(
            (alias) => alias.href === sourceApId.href,
        );
    }

    private async getTargetActor(
        ctx: FedifyContext,
        move: Move,
    ): Promise<Actor | null> {
        let target: unknown;

        try {
            const documentLoader = await ctx.getDocumentLoader({
                handle: 'index',
            });
            target = await lookupObject(move.targetId!, { documentLoader });
        } catch (err) {
            ctx.data.logger.debug('Move target lookup failed, exit early', {
                error: err,
            });
            return null;
        }

        if (!isActor(target) || !target.id) {
            ctx.data.logger.debug('Move target is not an actor, exit early');
            return null;
        }

        if (target.id.href !== move.targetId!.href) {
            ctx.data.logger.debug('Move target id does not match, exit early');
            return null;
        }

        return target;
    }

    private createSourceActor(sourceAccount: Account): Actor {
        return new Person({
            id: sourceAccount.apId,
            inbox: sourceAccount.apInbox,
            preferredUsername: sourceAccount.username,
        });
    }

    private async persistActivity(
        ctx: FedifyContext,
        move: Move,
        targetActor: Actor,
    ) {
        const [moveJson, targetJson] = await Promise.all([
            move.toJsonLd(),
            targetActor.toJsonLd(),
        ]);

        await Promise.all([
            ctx.data.globaldb.set([move.id!.href], moveJson),
            ctx.data.globaldb.set([targetActor.id!.href], targetJson),
        ]);
    }

    private async moveFollower(
        ctx: FedifyContext,
        follower: Account,
        sourceAccount: Account,
        targetAccount: Account,
        targetActor: Actor,
        sourceActor: Actor,
    ) {
        const canInteract = await this.moderationService.canFollowAccount(
            follower.id,
            targetAccount.id,
        );

        // If either side has blocked the other, skip this follower entirely.
        // The follow of the source account is intentionally left in place; a
        // block expresses an explicit decision, and the Move should not be
        // used to bypass it. The stale follow can be cleaned up manually.
        if (!canInteract) {
            ctx.data.logger.debug(
                `${follower.apId.href} is not allowed to follow ${targetAccount.apId.href}`,
            );
            return;
        }

        const alreadyFollowingTarget =
            await this.accountService.checkIfAccountIsFollowing(
                follower.id,
                targetAccount.id,
            );

        if (alreadyFollowingTarget) {
            await this.accountService.unfollowAccount(follower, sourceAccount);
        } else {
            await this.sendFollow(ctx, follower, targetActor);
            await this.accountService.migrateFollow(
                follower,
                sourceAccount,
                targetAccount,
            );
        }

        await this.sendUndoFollow(ctx, follower, sourceAccount, sourceActor);
    }

    private async sendFollow(
        ctx: FedifyContext,
        follower: Account,
        targetActor: Actor,
    ) {
        const follow = new Follow({
            id: ctx.getObjectUri(Follow, { id: uuidv4() }),
            actor: follower.apId,
            object: targetActor.id,
        });

        const followJson = await follow.toJsonLd();

        await ctx.data.globaldb.set([follow.id!.href], followJson);
        await ctx.sendActivity(
            { username: follower.username },
            targetActor,
            follow,
        );
    }

    private async sendUndoFollow(
        ctx: FedifyContext,
        follower: Account,
        sourceAccount: Account,
        sourceActor: Actor,
    ) {
        // Best-effort cleanup: the follower's local state has already been
        // migrated by this point, so a failed Undo only leaves a stale follow
        // on the source server. Swallow the error here so that the outer loop
        // does not treat the migration as failed.
        try {
            const follow = new Follow({
                id: null,
                actor: follower.apId,
                object: sourceAccount.apId,
            });
            const undo = new Undo({
                id: ctx.getObjectUri(Undo, { id: uuidv4() }),
                actor: follower.apId,
                object: follow,
            });
            const undoJson = await undo.toJsonLd();

            await ctx.data.globaldb.set([undo.id!.href], undoJson);
            await ctx.sendActivity(
                { username: follower.username },
                sourceActor,
                undo,
            );
        } catch (err) {
            ctx.data.logger.warn('Failed to send Undo for Move activity', {
                error: err,
                account: follower.apId.href,
                source: sourceAccount.apId.href,
            });
        }
    }
}
