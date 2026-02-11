import type { Actor, Delete } from '@fedify/fedify';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { FedifyContext } from '@/app';
import { exhaustiveCheck, getError, isError } from '@/core/result';
import { getRelatedActivities } from '@/db';
import type { PostService } from '@/post/post.service';

export class DeleteHandler {
    constructor(
        private readonly postService: PostService,
        private readonly accountService: AccountService,
    ) {}

    async handle(ctx: FedifyContext, deleteActivity: Delete) {
        ctx.data.logger.debug('Handling Delete');
        const parsed = ctx.parseUri(deleteActivity.objectId);
        ctx.data.logger.debug('Parsed delete object', { parsed });
        if (!deleteActivity.id) {
            ctx.data.logger.debug('Missing delete id - exit');
            return;
        }

        let sender: Actor | null = null;
        try {
            sender = await deleteActivity.getActor(ctx);
        } catch (error) {
            ctx.data.logger.error(
                'Error fetching sender from delete activity',
                { error },
            );
            return;
        }

        if (sender === null || sender.id === null) {
            ctx.data.logger.debug('Delete sender missing, exit early');
            return;
        }

        if (!deleteActivity.objectId) {
            ctx.data.logger.debug('Delete object id missing, exit early');
            return;
        }

        let senderAccount: Account | null = null;

        try {
            senderAccount = await this.accountService.getByApId(sender.id);
        } catch (error) {
            ctx.data.logger.error('Error fetching sender account', { error });
            return;
        }

        if (senderAccount === null) {
            ctx.data.logger.debug('Sender account not found, exit early');
            return;
        }

        const deleteResult = await this.postService.deleteByApId(
            deleteActivity.objectId,
            senderAccount,
        );

        if (isError(deleteResult)) {
            const error = getError(deleteResult);
            switch (error) {
                case 'upstream-error':
                case 'missing-author':
                case 'not-a-post':
                case 'not-author':
                    return;
                default:
                    return exhaustiveCheck(error);
            }
        }

        // Find all activities that reference this post and remove them from the kv-store
        const relatedActivities = await getRelatedActivities(
            deleteActivity.objectId.href,
        );

        const activities = await relatedActivities;
        for (const activity of activities) {
            const activityId = activity.id;

            await ctx.data.globaldb.delete([activityId]);
        }
    }
}
