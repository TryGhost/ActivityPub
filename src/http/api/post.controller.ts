import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import { parseURL } from 'core/url';
import type { ImageAttachment } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import { z } from 'zod';
import type { AppContext } from '../../app';
import { getRelatedActivities } from '../../db';
import { createDerepostActionHandler } from './derepost';
import { postToDTO } from './helpers/post';
import { handleCreateReply } from './reply';
import { createRepostActionHandler } from './repost';

/**
 * Controller for post-related operations
 */
export class PostController {
    constructor(
        private readonly postService: PostService,
        private readonly accountService: AccountService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly postRepository: KnexPostRepository,
    ) {}

    /**
     * Handle a request to get a post
     */
    async handleGetPost(ctx: AppContext) {
        const postApId = decodeURIComponent(ctx.req.param('post_ap_id'));
        const idAsUrl = parseURL(postApId);

        if (!idAsUrl) {
            return new Response(null, {
                status: 400,
            });
        }

        const postResult = await this.postService.getByApId(idAsUrl);

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

        const account = ctx.get('account');

        return new Response(
            JSON.stringify(
                postToDTO(post, {
                    authoredByMe: post.author.id === account.id,
                    likedByMe:
                        post.id && account.id
                            ? await this.postService.isLikedByAccount(
                                  post.id,
                                  account.id,
                              )
                            : false,
                    repostedByMe:
                        post.id && account.id
                            ? await this.postService.isRepostedByAccount(
                                  post.id,
                                  account.id,
                              )
                            : false,
                    repostedBy: null,
                    followingAuthor:
                        await this.accountService.checkIfAccountIsFollowing(
                            account.id,
                            post.author.id,
                        ),
                    followingReposter: false,
                }),
            ),
            { status: 200 },
        );
    }

    /**
     * Handle a request to delete a post
     */
    async handleDeletePost(ctx: AppContext) {
        const logger = ctx.get('logger');

        const id = ctx.req.param('id');

        const idAsUrl = parseURL(id);

        if (!idAsUrl) {
            return new Response(null, {
                status: 400,
            });
        }

        const account = await this.accountRepository.getBySite(ctx.get('site'));
        const postResult = await this.postService.getByApId(idAsUrl);

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
            await this.postRepository.save(post);

            // Find all activities that reference this post and remove them from the kv-store
            const relatedActivities = await getRelatedActivities(idAsUrl.href);

            const activities = await relatedActivities;
            for (const activity of activities) {
                const activityId = activity.id;

                await ctx.get('globaldb').delete([activityId]);
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
    }

    /**
     * Handle a request to create a note
     */
    async handleCreateNote(ctx: AppContext) {
        const NoteSchema = z.object({
            content: z.string(),
            image: z
                .object({
                    url: z.string().url(),
                    altText: z.string().optional(),
                })
                .optional(),
            imageUrl: z.string().url().optional(),
        });

        let data: z.infer<typeof NoteSchema>;

        try {
            data = NoteSchema.parse((await ctx.req.json()) as unknown);
        } catch (err) {
            return new Response(
                JSON.stringify({ error: 'Invalid request format' }),
                { status: 400 },
            );
        }

        let imageUrl: URL | undefined;

        if (data.imageUrl) {
            imageUrl = new URL(data.imageUrl);
        } else if (data.image) {
            imageUrl = new URL(data.image.url);
        }

        const image: ImageAttachment | undefined = imageUrl
            ? {
                  url: imageUrl,
                  altText: data.image?.altText ?? undefined,
              }
            : undefined;

        const postResult = await this.postService.createNote(
            ctx.get('account'),
            data.content,
            image,
        );

        if (isError(postResult)) {
            const error = getError(postResult);
            let errorMessage = 'Error verifying image URL';
            switch (error) {
                case 'invalid-url':
                    errorMessage = 'Invalid image URL format';
                    break;
                case 'invalid-file-path':
                    errorMessage = 'Invalid image file path';
                    break;
                case 'file-not-found':
                    errorMessage = 'Image not found in storage';
                    break;
                default:
                    return exhaustiveCheck(error);
            }

            return new Response(JSON.stringify({ error: errorMessage }), {
                status: 400,
            });
        }

        const post = getValue(postResult);

        const postDTO = postToDTO(post, {
            authoredByMe: true,
            likedByMe: false,
            repostedByMe: false,
            repostedBy: null,
            followingAuthor: false,
            followingReposter: false,
        });

        return new Response(JSON.stringify({ post: postDTO }), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    /**
     * Handle a request to create a reply
     */
    async handleCreateReply(ctx: AppContext) {
        return handleCreateReply(ctx, this.postService);
    }

    /**
     * Handle a request to repost
     */
    async handleRepost(ctx: AppContext) {
        const handler = createRepostActionHandler(this.postService);
        return handler(ctx);
    }

    /**
     * Handle a request to derepost
     */
    async handleDerepost(ctx: AppContext) {
        const handler = createDerepostActionHandler(
            this.postService,
            this.postRepository,
        );
        return handler(ctx);
    }
}
