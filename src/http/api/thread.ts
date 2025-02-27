import type { AccountService } from 'account/account.service';
import type { AppContext } from '../../app';
import type { KnexPostRepository } from '../../post/post.repository.knex';
import { postToDTO } from './helpers/post';

/**
 * Create a handler for a request for a thread
 *
 * @param postRepository Post repository instance
 * @param accountService Account service instance
 */
export function createGetThreadHandler(
    postRepository: KnexPostRepository,
    accountService: AccountService,
) {
    /**
     * Handle a request for a thread
     *
     * @param ctx App context instance
     */
    return async function handleGetThread(ctx: AppContext) {
        const postApId = decodeURIComponent(ctx.req.param('post_ap_id'));

        const account = await accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );

        const posts = (
            await postRepository.getThreadByApId(postApId, account.id)
        ).map(({ post, likedByAccount, repostedByAccount }) => {
            return postToDTO(post, {
                likedByMe: likedByAccount,
                repostedByMe: repostedByAccount,
                repostedBy: null,
            });
        });

        return new Response(
            JSON.stringify({
                posts,
            }),
            {
                status: 200,
            },
        );
    };
}
