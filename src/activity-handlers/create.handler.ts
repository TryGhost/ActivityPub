import type { Context, Create } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { ContextData } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
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

        if (!create.objectId) {
            ctx.data.logger.info('Create object id missing, exit early');
            return;
        }

        // This handles storing the posts in the posts table
        const postResult = await this.postService.getByApId(create.objectId);

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'upstream-error':
                    ctx.data.logger.info(
                        'Upstream error fetching post for create handling',
                        {
                            postId: create.objectId.href,
                        },
                    );
                    return;
                case 'not-a-post':
                    ctx.data.logger.info(
                        'Resource is not a post in create handling',
                        {
                            postId: create.objectId.href,
                        },
                    );
                    return;
                case 'missing-author':
                    ctx.data.logger.info(
                        'Post has missing author in create handling',
                        {
                            postId: create.objectId.href,
                        },
                    );
                    return;
                default:
                    return exhaustiveCheck(error);
            }
        }

        const createJson = await create.toJsonLd();
        ctx.data.globaldb.set([create.id.href], createJson);

        const object = await create.getObject();
        const replyTarget = await object?.getReplyTarget();

        console.log({ replyTarget });

        if (replyTarget?.id?.href) {
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            const data = await ctx.data.globaldb.get<any>([
                replyTarget.id.href,
            ]);
            let replyTargetAuthor = '';
            if (typeof data?.attributedTo === 'string') {
                replyTargetAuthor = data?.attributedTo;
            } else {
                replyTargetAuthor = data?.attributedTo?.id;
            }
            const inboxActor = await getUserData(ctx, 'index');

            if (replyTargetAuthor === inboxActor.id.href) {
                await addToList(ctx.data.db, ['inbox'], create.id.href);
                return;
            }
        }

        const site = await this.siteService.getSiteByHost(ctx.host);

        if (!site) {
            throw new Error(`Site not found for host: ${ctx.host}`);
        }

        const post = getValue(postResult);

        const account = await this.accountService.getAccountForSite(site);

        const isFollowing = await this.accountService.checkIfAccountIsFollowing(
            account.id,
            post.author.id,
        );

        if (isFollowing) {
            await addToList(ctx.data.db, ['inbox'], create.id.href);
            return;
        }
    }
}
