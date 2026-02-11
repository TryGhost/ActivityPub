import { Accept, type Actor, type Follow, Reject } from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { AccountService } from '@/account/account.service';
import type { FedifyContext } from '@/app';
import { getValue, isError } from '@/core/result';
import type { ModerationService } from '@/moderation/moderation.service';

export class FollowHandler {
    constructor(
        private readonly accountService: AccountService,
        private readonly moderationService: ModerationService,
    ) {}

    async handle(ctx: FedifyContext, follow: Follow) {
        ctx.data.logger.debug('Handling Follow');

        // Validate activity data
        if (!follow.id) {
            ctx.data.logger.debug('Follow missing id, exit early');
            return;
        }

        if (!follow.objectId) {
            ctx.data.logger.debug('Follow missing objectId, exit early');
            return;
        }

        const parsed = ctx.parseUri(follow.objectId);
        if (parsed?.type !== 'actor') {
            ctx.data.logger.debug('Follow object is not an actor, exit early');
            return;
        }

        const sender = await follow.getActor(ctx);
        if (sender === null || sender.id === null) {
            ctx.data.logger.debug('Follow sender missing, exit early');
            return;
        }

        // Persist the activity and sender in the db
        await this.persistActivity(ctx, follow, sender);

        // Resolve the accounts of the account to follow and the follower,
        // and check if the follow is allowed
        const accountToFollowResult = await this.accountService.ensureByApId(
            follow.objectId,
        );
        if (isError(accountToFollowResult)) {
            ctx.data.logger.debug('Account to follow not found, exit early');
            return;
        }
        const accountToFollow = getValue(accountToFollowResult);

        const followerAccountResult = await this.accountService.ensureByApId(
            sender.id,
        );
        if (isError(followerAccountResult)) {
            ctx.data.logger.debug('Follower account not found, exit early');
            return;
        }
        const followerAccount = getValue(followerAccountResult);

        const isFollowAllowed =
            await this.moderationService.canInteractWithAccount(
                followerAccount.id,
                accountToFollow.id,
            );

        if (!isFollowAllowed) {
            ctx.data.logger.debug(
                `${followerAccount.apId} is not allowed to follow ${accountToFollow.apId}, sending reject`,
            );

            await this.sendReject(ctx, follow, parsed.handle, sender);

            return;
        }

        // Record the follow and send an accept activity to the sender
        await this.accountService.followAccount(
            followerAccount,
            accountToFollow,
        );

        await this.sendAccept(ctx, follow, parsed.identifier, sender);
    }

    private async persistActivity(
        ctx: FedifyContext,
        follow: Follow,
        sender: Actor,
    ) {
        const followJson = await follow.toJsonLd();
        const senderJson = await sender.toJsonLd();

        await Promise.all([
            // Persist activity in the global db
            ctx.data.globaldb.set([follow.id!.href], followJson),
            // Persist or update sender in global db
            ctx.data.globaldb.set([sender.id!.href], senderJson),
        ]);
    }

    private async sendAccept(
        ctx: FedifyContext,
        follow: Follow,
        identifier: string,
        sender: Actor,
    ): Promise<void> {
        const acceptId = ctx.getObjectUri(Accept, { id: uuidv4() });
        const accept = new Accept({
            id: acceptId,
            actor: follow.objectId,
            object: follow,
        });
        const acceptJson = await accept.toJsonLd();

        await ctx.data.globaldb.set([accept.id!.href], acceptJson);

        await ctx.sendActivity({ identifier }, sender, accept);
    }

    private async sendReject(
        ctx: FedifyContext,
        follow: Follow,
        identifier: string,
        sender: Actor,
    ): Promise<void> {
        const rejectId = ctx.getObjectUri(Reject, { id: uuidv4() });
        const reject = new Reject({
            id: rejectId,
            actor: follow.objectId,
            object: follow,
        });
        const rejectJson = await reject.toJsonLd();

        await ctx.data.globaldb.set([reject.id!.href], rejectJson);

        await ctx.sendActivity({ identifier }, sender, reject);
    }
}
