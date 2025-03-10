import type { Context, Delete } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { ContextData } from 'app';
import type { Post } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import { getRelatedActivities } from '../db';
import { removeFromList } from '../kv-helpers';

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

        const sender = await deleteActivity.getActor(ctx);
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

        let post: Post | null = null;

        try {
            post = await this.postService.getByApId(deleteActivity.objectId);
        } catch (error) {
            ctx.data.logger.error('Error fetching post', { error });
            return;
        }

        if (post === null) {
            ctx.data.logger.info('Post not found, exit early');
            return;
        }

        post.delete(senderAccount);
        await this.postRepository.save(post);

        // Find all activities that reference this post and remove them from the kv-store
        const relatedActivities = await getRelatedActivities(
            deleteActivity.objectId.href,
        );

        const activities = await relatedActivities;
        for (const activity of activities) {
            const activityId = activity.id;

            await ctx.data.globaldb.delete([activityId]);

            await removeFromList(ctx.data.db, ['inbox'], activityId);
            await removeFromList(ctx.data.db, ['outbox'], activityId);
            await removeFromList(ctx.data.db, ['liked'], activityId);
            await removeFromList(ctx.data.db, ['reposted'], activityId);
        }
    }
}
