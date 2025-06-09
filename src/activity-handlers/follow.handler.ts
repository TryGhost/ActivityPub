import {
    Accept,
    type Actor,
    type Context,
    type Follow,
    Reject,
} from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { ContextData } from 'app';
import { getValue, isError } from 'core/result';
import type { ModerationService } from 'moderation/moderation.service';
import { v4 as uuidv4 } from 'uuid';

export class FollowHandler {
    constructor(
        private readonly accountService: AccountService,
        private readonly moderationService: ModerationService,
    ) {}

    async handle(ctx: Context<ContextData>, follow: Follow) {
        ctx.data.logger.info(
            'Handling Follow on {host} with id {id} and objectId {objectId}',
            {
                host: ctx.host,
                id: follow.id,
                objectId: follow.objectId,
            },
        );

        // Validate activity data
        if (!follow.id) {
            ctx.data.logger.error('Follow missing id');
            return;
        }

        if (!follow.objectId) {
            ctx.data.logger.error('Follow missing objectId', {
                apId: follow.id.href,
            });
            return;
        }

        const parsed = ctx.parseUri(follow.objectId);
        if (parsed?.type !== 'actor') {
            ctx.data.logger.error('Follow object is not an actor', {
                apId: follow.id.href,
            });
            return;
        }

        const sender = await follow.getActor(ctx);
        if (sender === null || sender.id === null) {
            ctx.data.logger.error('Follow sender missing', {
                apId: follow.id.href,
            });
            return;
        }

        ctx.data.logger.info(`Handling Follow ${follow.id}`, {
            apId: follow.id.href,
            follower: sender.id.href,
            following: follow.objectId.href,
        });

        // Persist the activity and sender in the db
        await this.persistActivity(ctx, follow, sender);

        // Resolve the accounts of the account to follow and the follower,
        // and check if the follow is allowed
        const accountToFollowResult = await this.accountService.ensureByApId(
            follow.objectId,
        );
        if (isError(accountToFollowResult)) {
            ctx.data.logger.error('Follow account to follow not found', {
                apId: follow.id.href,
                follower: sender.id.href,
                following: follow.objectId.href,
            });
            return;
        }
        const accountToFollow = getValue(accountToFollowResult);

        const followerAccountResult = await this.accountService.ensureByApId(
            sender.id,
        );
        if (isError(followerAccountResult)) {
            ctx.data.logger.error('Follow follower account not found', {
                apId: follow.id.href,
                follower: sender.id.href,
                following: follow.objectId.href,
            });
            return;
        }
        const followerAccount = getValue(followerAccountResult);

        const isFollowAllowed =
            await this.moderationService.canInteractWithAccount(
                followerAccount.id,
                accountToFollow.id,
            );

        if (!isFollowAllowed) {
            ctx.data.logger.error('Follow not allowed', {
                apId: follow.id.href,
                follower: followerAccount.apId,
                following: accountToFollow.apId,
            });

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
        ctx: Context<ContextData>,
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
        ctx: Context<ContextData>,
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
        ctx: Context<ContextData>,
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
