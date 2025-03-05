import type { KnexAccountRepository } from 'account/account.repository.knex';
import { createHash } from 'node:crypto';
import { fedify } from '../../app';
import { parseURL } from 'core/url';
import { removeFromList } from '../../kv-helpers';
import type { AppContext } from '../../app';
import { Like } from '@fedify/fedify';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';

/**
 * Create a handler for a request to delete a post
 */
export function createDeletePostHandler(
    accountRepository: KnexAccountRepository,
    postRepository: KnexPostRepository,
    postService: PostService,
) {
    /**
     * Handle a request to delete a post
     */
    return async function handleDeletePost(ctx: AppContext) {
        const logger = ctx.get('logger');

        const id = ctx.req.param('id');

        const idAsUrl = parseURL(id);

        if (!idAsUrl) {
            return new Response(null, {
                status: 400,
            });
        }

        const account = await accountRepository.getBySite(ctx.get('site'));
        const post = await postService.getByApId(idAsUrl);

        if (!post) {
            return new Response(null, {
                status: 404,
            });
        }

        if (post.author.uuid !== account.uuid) {
            return new Response(null, {
                status: 403,
            });
        }

        try {
            // Delete the post from the database
            post.delete(account);
            await postRepository.save(post);

            const apCtx = fedify.createContext(ctx.req.raw as Request, {
                db: ctx.get('db'),
                globaldb: ctx.get('globaldb'),
                logger: ctx.get('logger'),
            });

            const outboxActivityIds =
                (await ctx.get('db').get<string[]>(['outbox'])) || [];
            for (const activityId of outboxActivityIds) {
                const activity = (await ctx
                    .get('globaldb')
                    .get([activityId])) as {
                    object: { id: string };
                };
                // Remove the create activity which contains the post
                if (activity?.object?.id === idAsUrl.href) {
                    await removeFromList(ctx.get('db'), ['outbox'], activityId);
                    await ctx.get('globaldb').delete([activityId]);
                }
            }

            const likeId = apCtx.getObjectUri(Like, {
                id: createHash('sha256').update(idAsUrl.href).digest('hex'),
            });

            // Remove the like from the kvStore
            await removeFromList(ctx.get('db'), ['liked'], likeId!.href);
            await ctx.get('globaldb').delete([likeId!.href]);

            // Remove the post from the kvStore
            await ctx.get('globaldb').delete([idAsUrl.href]);

            return new Response(null, {
                status: 204,
            });
        } catch (err) {
            logger.error('Error deleting post - {error}', {
                error: err,
            });
            return new Response(JSON.stringify(err), { status: 500 });
        }
    };
}
