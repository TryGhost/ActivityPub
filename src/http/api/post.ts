import type { KnexAccountRepository } from 'account/account.repository.knex';
import { parseURL } from 'core/url';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import type { AppContext } from '../../app';
import { getRelatedActivities } from '../../db';
import { removeFromList } from '../../kv-helpers';
import { postToDTO } from './helpers/post';

/**
 * Create a handler for a request to get a post
 */
export function createGetPostHandler(postService: PostService) {
    /**
     * Handle a request to get a post
     */
    return async function handleGetPost(ctx: AppContext) {
        const postApId = decodeURIComponent(ctx.req.param('post_ap_id'));
        const idAsUrl = parseURL(postApId);

        if (!idAsUrl) {
            return new Response(null, {
                status: 400,
            });
        }

        const post = await postService.getByApId(idAsUrl);

        if (!post) {
            return new Response(null, {
                status: 404,
            });
        }

        return new Response(JSON.stringify(postToDTO(post)), {
            status: 200,
        });
    };
}

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

            // Find all activities that reference this post and remove them from the kv-store
            const relatedActivities = await getRelatedActivities(idAsUrl.href);

            const activities = await relatedActivities;
            for (const activity of activities) {
                const activityId = activity.id;

                await ctx.get('globaldb').delete([activityId]);

                await removeFromList(ctx.get('db'), ['inbox'], activityId);
                await removeFromList(ctx.get('db'), ['outbox'], activityId);
                await removeFromList(ctx.get('db'), ['liked'], activityId);
                await removeFromList(ctx.get('db'), ['reposted'], activityId);
            }

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
