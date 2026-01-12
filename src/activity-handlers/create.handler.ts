import { type Context, type Create, PUBLIC_COLLECTION } from '@fedify/fedify';

import type { FedifyContextData } from '@/app';
import { exhaustiveCheck, getError, isError } from '@/core/result';
import type { PostService } from '@/post/post.service';

export class CreateHandler {
    constructor(private readonly postService: PostService) {}

    async handle(ctx: Context<FedifyContextData>, create: Create) {
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

        const recipients = [...create.toIds, ...create.ccIds].map(
            (id) => id.href,
        );
        const isPublic = recipients.includes(PUBLIC_COLLECTION.href);

        if (!isPublic) {
            ctx.data.logger.info('Create activity is not public - exit');
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
    }
}
