import type { Context, Create } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { ContextData } from 'app';
import { isFollowedByDefaultSiteAccount } from 'helpers/activitypub/actor';
import { getUserData } from 'helpers/user';
import { addToList } from 'kv-helpers';
import type { PostService } from 'post/post.service';
import type { SiteService } from 'site/site.service';

export class CreateHandler {
    constructor(
        private readonly postService: PostService,
        private readonly accountService: AccountService,
        private readonly siteService: SiteService,
    ) {}

    async handle(ctx: Context<ContextData>, create: Create) {
        ctx.data.logger.info('Handling Create');
        const parsed = ctx.parseUri(create.objectId);
        ctx.data.logger.info('Parsed create object', { parsed });
        if (!create.id) {
            ctx.data.logger.info('Create missing id - exit');
            return;
        }

        const sender = await create.getActor(ctx);
        if (sender === null || sender.id === null) {
            ctx.data.logger.info('Create sender missing, exit early');
            return;
        }

        if (!create.objectId) {
            ctx.data.logger.info('Create object id missing, exit early');
            return;
        }

        // This handles storing the posts in the posts table
        const post = await this.postService.getByApId(create.objectId);

        const createJson = await create.toJsonLd();
        ctx.data.globaldb.set([create.id.href], createJson);

        const object = await create.getObject();
        const replyTarget = await object?.getReplyTarget();

        if (replyTarget?.id?.href) {
            const data = await ctx.data.globaldb.get<any>([
                replyTarget.id.href,
            ]);
            const replyTargetAuthor = data?.attributedTo?.id;
            const inboxActor = await getUserData(ctx, 'index');

            if (replyTargetAuthor === inboxActor.id.href) {
                await addToList(ctx.data.db, ['inbox'], create.id.href);
                return;
            }
        }

        let shouldAddToInbox = false;

        const site = await this.siteService.getSiteByHost(ctx.host);

        if (!site) {
            throw new Error(`Site not found for host: ${ctx.host}`);
        }

        shouldAddToInbox = await isFollowedByDefaultSiteAccount(
            sender,
            site,
            this.accountService,
        );

        if (shouldAddToInbox) {
            await addToList(ctx.data.db, ['inbox'], create.id.href);
            return;
        }
    }
}
