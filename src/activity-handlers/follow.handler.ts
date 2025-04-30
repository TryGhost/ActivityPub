import { Accept, type Context, type Follow } from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { AccountService } from 'account/account.service';
import { mapActorToExternalAccountData } from 'account/utils';
import type { ContextData } from 'app';
import { addToList } from 'kv-helpers';

export class FollowHandler {
    constructor(private readonly accountService: AccountService) {}

    async handle(ctx: Context<ContextData>, follow: Follow) {
        ctx.data.logger.info('Handling Follow');
        if (!follow.id) {
            return;
        }
        const parsed = ctx.parseUri(follow.objectId);
        if (parsed?.type !== 'actor') {
            // TODO Log
            return;
        }
        const sender = await follow.getActor(ctx);
        if (sender === null || sender.id === null) {
            return;
        }

        // Add follow activity to inbox
        const followJson = await follow.toJsonLd();

        ctx.data.globaldb.set([follow.id.href], followJson);
        await addToList(ctx.data.db, ['inbox'], follow.id.href);

        // Record follower in followers list
        const senderJson = await sender.toJsonLd();

        // Store or update sender in global db
        ctx.data.globaldb.set([sender.id.href], senderJson);

        // Record the account of the sender as well as the follow
        const followeeAccount = await this.accountService.getAccountByApId(
            follow.objectId?.href ?? '',
        );
        if (followeeAccount) {
            let followerAccount = await this.accountService.getAccountByApId(
                sender.id.href,
            );

            if (!followerAccount) {
                ctx.data.logger.info(
                    `Follower account "${sender.id.href}" not found, creating`,
                );

                followerAccount =
                    await this.accountService.createExternalAccount(
                        await mapActorToExternalAccountData(sender),
                    );
            }

            await this.accountService.recordAccountFollow(
                followeeAccount,
                followerAccount,
            );
        }

        // Send accept activity to sender
        const acceptId = ctx.getObjectUri(Accept, { id: uuidv4() });
        const accept = new Accept({
            id: acceptId,
            actor: follow.objectId,
            object: follow,
        });
        const acceptJson = await accept.toJsonLd();

        await ctx.data.globaldb.set([accept.id!.href], acceptJson);

        await ctx.sendActivity({ handle: parsed.handle }, sender, accept);
    }
}
