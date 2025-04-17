import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
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
export function createGetPostHandler(
    postService: PostService,
    accountService: AccountService,
) {
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

        const postResult = await postService.getByApId(idAsUrl);

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'upstream-error':
                    ctx.get('logger')?.info('Upstream error fetching post', {
                        postId: idAsUrl.href,
                    });
                    return new Response(null, { status: 404 });
                case 'not-a-post':
                    ctx.get('logger')?.info('Resource is not a post', {
                        postId: idAsUrl.href,
                    });
                    return new Response(null, { status: 404 });
                case 'missing-author':
                    ctx.get('logger')?.info('Post author missing', {
                        postId: idAsUrl.href,
                    });
                    return new Response(null, { status: 404 });
                default:
                    return exhaustiveCheck(error);
            }
        }

        const post = getValue(postResult);

        const account = await accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );

        return new Response(
            JSON.stringify(
                postToDTO(post, {
                    authoredByMe: post.author.id === account.id,
                    likedByMe:
                        post.id && account.id
                            ? await postService.isLikedByAccount(
                                  post.id,
                                  account.id,
                              )
                            : false,
                    repostedByMe:
                        post.id && account.id
                            ? await postService.isRepostedByAccount(
                                  post.id,
                                  account.id,
                              )
                            : false,
                    repostedBy: null,
                }),
            ),
            { status: 200 },
        );
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
        const postResult = await postService.getByApId(idAsUrl);

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'upstream-error':
                    logger.info('Upstream error fetching post for deletion', {
                        postId: idAsUrl.href,
                    });
                    return new Response(null, { status: 400 });
                case 'not-a-post':
                    logger.info(
                        'Resource requested for deletion is not a post',
                        { postId: idAsUrl.href },
                    );
                    return new Response(null, { status: 400 });
                case 'missing-author':
                    logger.info(
                        'Post requested for deletion has missing author',
                        { postId: idAsUrl.href },
                    );
                    return new Response(null, { status: 400 });
                default:
                    return exhaustiveCheck(error);
            }
        }

        const post = getValue(postResult);

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
