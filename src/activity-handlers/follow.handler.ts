import {
    Accept,
    type Actor,
    type Context,
    type Follow,
    Reject,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { Logger } from '@logtape/logtape';
import type { AccountService } from 'account/account.service';
import type { Account } from 'account/types';
import { mapActorToExternalAccountData } from 'account/utils';
import type { ContextData } from 'app';
import { addToList } from 'kv-helpers';
import type { ModerationService } from 'moderation/moderation.service';

export class FollowHandler {
    constructor(
        private readonly accountService: AccountService,
        private readonly moderationService: ModerationService,
    ) {}

    async handle(ctx: Context<ContextData>, follow: Follow) {
        ctx.data.logger.info('Handling Follow');

        // Validate activity data
        if (!follow.id) {
            ctx.data.logger.info('Follow missing id, exit early');
            return;
        }

        if (!follow.objectId) {
            ctx.data.logger.info('Follow missing objectId, exit early');
            return;
        }

        const parsed = ctx.parseUri(follow.objectId);
        if (parsed?.type !== 'actor') {
            ctx.data.logger.info('Follow object is not an actor, exit early');
            return;
        }

        const sender = await follow.getActor(ctx);
        if (sender === null || sender.id === null) {
            ctx.data.logger.info('Follow sender missing, exit early');
            return;
        }

        // Persist the activity and sender in the db
        await this.persistActivity(ctx, follow, sender);

        // Resolve the accounts of the account to follow and the follower,
        // and check if the follow is allowed
        const accountToFollow = await this.accountService.getAccountByApId(
            follow.objectId.href,
        );

        if (!accountToFollow) {
            ctx.data.logger.info('Account to follow not found, exit early');
            return;
        }

        const followerAccount = await this.getFollowerAccount(
            sender,
            ctx.data.logger,
        );

        if (!followerAccount) {
            ctx.data.logger.info('Follower account not found, exit early');
            return;
        }

        const isFollowAllowed =
            await this.moderationService.canInteractWithAccount(
                followerAccount.id,
                accountToFollow.id,
            );

        if (!isFollowAllowed) {
            ctx.data.logger.info(
                `${followerAccount.ap_id} is not allowed to follow ${accountToFollow.ap_id}, sending reject`,
            );

            await this.sendReject(ctx, follow, parsed.handle, sender);

            return;
        }

        // Record the follow and send an accept activity to the sender
        await this.accountService.recordAccountFollow(
            accountToFollow,
            followerAccount,
        );

        await this.sendAccept(ctx, follow, parsed.handle, sender);
    }

    private async persistActivity(
        ctx: Context<ContextData>,
        follow: Follow,
        sender: Actor,
    ) {
        const followJson = await follow.toJsonLd();
        const senderJson = await sender.toJsonLd();

        await Promise.all([
            // Persist activity in the global db
            ctx.data.globaldb.set([follow.id!.href], followJson),
            // Add activity to the inbox for context account
            addToList(ctx.data.db, ['inbox'], follow.id!.href),
            // Persist or update sender in global db
            ctx.data.globaldb.set([sender.id!.href], senderJson),
        ]);
    }

    private async getFollowerAccount(
        sender: Actor,
        logger: Logger,
    ): Promise<Account> {
        let account = await this.accountService.getAccountByApId(
            sender.id?.href ?? '',
        );

        if (!account) {
            logger.info(
                `Follower account "${sender.id?.href}" not found, creating`,
            );

            account = await this.accountService.createExternalAccount(
                await mapActorToExternalAccountData(sender),
            );
        }

        return account;
    }

    private async sendAccept(
        ctx: Context<ContextData>,
        follow: Follow,
        handle: string,
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

        await ctx.sendActivity({ handle }, sender, accept);
    }

    private async sendReject(
        ctx: Context<ContextData>,
        follow: Follow,
        handle: string,
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

        await ctx.sendActivity({ handle }, sender, reject);
    }
}
