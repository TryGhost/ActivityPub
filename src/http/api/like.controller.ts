import type { Federation } from '@fedify/fedify';

import type { AppContext, ContextData } from '@/app';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import { parseURL } from '@/core/url';
import { Conflict, Forbidden } from '@/http/api/helpers/response';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import { lookupObject } from '@/lookup-helpers';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { PostService } from '@/post/post.service';

export class LikeController {
    constructor(
        private readonly postService: PostService,
        private readonly postRepository: KnexPostRepository,
        private readonly fedify: Federation<ContextData>,
    ) {}

    @APIRoute('POST', 'actions/like/:id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleLike(ctx: AppContext) {
        const account = ctx.get('account');
        const id = ctx.req.param('id');
        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const objectToLike = await lookupObject(apCtx, id);
        if (!objectToLike) {
            return new Response(
                JSON.stringify({ error: 'Object to like not found' }),
                { status: 404 },
            );
        }

        const idAsUrl = parseURL(id);
        if (!idAsUrl) {
            return new Response(
                JSON.stringify({ error: 'ID should be a valid URL' }),
                { status: 400 },
            );
        }

        const postResult = await this.postService.getByApId(idAsUrl);

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'upstream-error':
                    ctx.get('logger').info(
                        'Upstream error fetching post for liking',
                        { postId: idAsUrl.href },
                    );
                    break;
                case 'not-a-post':
                    ctx.get('logger').info(
                        'Resource for liking is not a post',
                        { postId: idAsUrl.href },
                    );
                    break;
                case 'missing-author':
                    ctx.get('logger').info(
                        'Post for liking has missing author',
                        { postId: idAsUrl.href },
                    );
                    break;
                default:
                    return exhaustiveCheck(error);
            }

            // Return success even if we couldn't track the like locally
            // The user's intent was to like, and lookup succeeded
            return new Response(JSON.stringify({ liked: true }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        const post = getValue(postResult);
        const likePostResult = await this.postService.likePost(account, post);

        if (isError(likePostResult)) {
            const error = getError(likePostResult);
            switch (error) {
                case 'cannot-interact':
                    return Forbidden('Cannot interact with this account');
                case 'already-liked':
                    return Conflict('Post already liked');
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(JSON.stringify({ liked: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    @APIRoute('POST', 'actions/unlike/:id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleUnlike(ctx: AppContext) {
        const account = ctx.get('account');
        const id = ctx.req.param('id');
        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const objectToUnlike = await lookupObject(apCtx, id);
        if (!objectToUnlike) {
            return new Response(
                JSON.stringify({ error: 'Object to unlike not found' }),
                { status: 404 },
            );
        }

        const idAsUrl = parseURL(id);
        if (!idAsUrl) {
            return new Response(
                JSON.stringify({ error: 'ID should be a valid URL' }),
                { status: 400 },
            );
        }

        const postResult = await this.postService.getByApId(idAsUrl);

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'upstream-error':
                    ctx.get('logger').info(
                        'Upstream error fetching post for unliking',
                        { postId: idAsUrl.href },
                    );
                    break;
                case 'not-a-post':
                    ctx.get('logger').info(
                        'Resource for unliking is not a post',
                        { postId: idAsUrl.href },
                    );
                    break;
                case 'missing-author':
                    ctx.get('logger').info(
                        'Post for unliking has missing author',
                        { postId: idAsUrl.href },
                    );
                    break;
                default:
                    return exhaustiveCheck(error);
            }

            return new Response(JSON.stringify({ unliked: true }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }

        const post = getValue(postResult);
        post.removeLike(account);
        await this.postRepository.save(post);

        return new Response(JSON.stringify({ unliked: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    }
}
