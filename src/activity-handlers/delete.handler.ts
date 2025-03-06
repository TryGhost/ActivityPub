import type { Context, Delete } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { ContextData } from 'app';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';

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

        const senderAccount = await this.accountService.getByApId(sender.id);

        if (senderAccount === null) {
            ctx.data.logger.info('Sender account not found, exit early');
            return;
        }

        const post = await this.postService.getByApId(deleteActivity.objectId);

        if (post === null) {
            ctx.data.logger.info('Post not found, exit early');
            return;
        }

        post.delete(senderAccount);
        await this.postRepository.save(post);

        return;
    }
}
