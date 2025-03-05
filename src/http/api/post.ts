import type { KnexAccountRepository } from 'account/account.repository.knex';
import { parseURL } from 'core/url';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import type { AppContext } from '../../app';
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
            post.delete(account);
            await postRepository.save(post);

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
