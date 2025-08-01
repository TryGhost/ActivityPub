import type { Actor, Context, Delete } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { ContextData } from 'app';
import { exhaustiveCheck, getError, isError } from 'core/result';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import { getRelatedActivities } from '../db';

export class DeleteHandler {
    constructor(
        private readonly postService: PostService,
        private readonly accountService: AccountService,
        private readonly postRepository: KnexPostRepository,
    ) {}

    async handle(ctx: Context<ContextData>, deleteActivity: Delete) {
        ctx.data.logger.info('Handling Delete');
        const parsed = ctx.parseUri(deleteActivity.objectId);
        ctx.data.logger.info('Parsed delete object', { parsed });
        if (!deleteActivity.id) {
            ctx.data.logger.info('Missing delete id - exit');
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
            ctx.data.logger.info('Delete sender missing, exit early');
            return;
        }

        if (!deleteActivity.objectId) {
            ctx.data.logger.info('Delete object id missing, exit early');
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
            ctx.data.logger.info('Sender account not found, exit early');
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
