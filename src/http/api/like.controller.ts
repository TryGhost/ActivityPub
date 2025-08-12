import { createHash } from 'node:crypto';

import {
    type Actor,
    type Federation,
    Like,
    PUBLIC_COLLECTION,
    Undo,
} from '@fedify/fedify';

import type { AppContext, ContextData } from '@/app';
import { ACTOR_DEFAULT_HANDLE } from '@/constants';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import { parseURL } from '@/core/url';
import { Forbidden } from '@/http/api/helpers/response';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import { lookupActor, lookupObject } from '@/lookup-helpers';
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
                {
                    status: 404,
                },
            );
        }

        const idAsUrl = parseURL(id);

        if (!idAsUrl) {
            return new Response(
                JSON.stringify({ error: 'ID should be a valid URL' }),
                {
                    status: 400,
                },
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
        } else {
            const post = getValue(postResult);

            const likePostResult = await this.postService.likePost(
                account,
                post,
            );

            if (isError(likePostResult)) {
                const error = getError(likePostResult);

                switch (error) {
                    case 'cannot-interact':
                        return Forbidden('Cannot interact with this account');
                    default:
                        return exhaustiveCheck(error);
                }
            }
        }

        const likeId = apCtx.getObjectUri(Like, {
            id: createHash('sha256')
                .update(objectToLike.id!.href)
                .digest('hex'),
        });

        if (await ctx.get('globaldb').get([likeId.href])) {
            return new Response(
                JSON.stringify({ error: 'Post already liked' }),
                {
                    status: 409,
                },
            );
        }

        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

        const like = new Like({
            id: likeId,
            actor: actor,
            object: objectToLike,
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
        });
        const likeJson = await like.toJsonLd();
        await ctx.get('globaldb').set([like.id!.href], likeJson);

        let attributionActor: Actor | null = null;
        if (objectToLike.attributionId) {
            attributionActor = await lookupActor(
                apCtx,
                objectToLike.attributionId.href,
            );
        }
        if (attributionActor) {
            apCtx.sendActivity(
                { username: account.username },
                attributionActor,
                like,
                {
                    preferSharedInbox: true,
                },
            );
        }

        apCtx.sendActivity({ username: account.username }, 'followers', like, {
            preferSharedInbox: true,
        });
        return new Response(JSON.stringify(likeJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
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

        const objectToLike = await lookupObject(apCtx, id);
        if (!objectToLike) {
            return new Response(
                JSON.stringify({ error: 'Object to like not found' }),
                {
                    status: 404,
                },
            );
        }

        const likeId = apCtx.getObjectUri(Like, {
            id: createHash('sha256')
                .update(objectToLike.id!.href)
                .digest('hex'),
        });

        const undoId = apCtx.getObjectUri(Undo, {
            id: createHash('sha256').update(likeId.href).digest('hex'),
        });

        const likeToUndoJson = await ctx.get('globaldb').get([likeId.href]);
        if (!likeToUndoJson) {
            return new Response(
                JSON.stringify({ error: 'Like activity not found' }),
                {
                    status: 409,
                },
            );
        }

        const idAsUrl = parseURL(id);

        if (!idAsUrl) {
            return new Response(
                JSON.stringify({ error: 'ID should be a valid URL' }),
                {
                    status: 400,
                },
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
        } else {
            const post = getValue(postResult);
            post.removeLike(account);
            await this.postRepository.save(post);
        }

        const likeToUndo = await Like.fromJsonLd(likeToUndoJson);

        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

        const undo = new Undo({
            id: undoId,
            actor: actor,
            object: likeToUndo,
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
        });
        const undoJson = await undo.toJsonLd();

        await ctx.get('globaldb').set([undo.id!.href], undoJson);
        await ctx.get('globaldb').delete([likeId!.href]);

        let attributionActor: Actor | null = null;
        if (objectToLike.attributionId) {
            attributionActor = await lookupActor(
                apCtx,
                objectToLike.attributionId.href,
            );
        }
        if (attributionActor) {
            apCtx.sendActivity(
                { username: account.username },
                attributionActor,
                undo,
                {
                    preferSharedInbox: true,
                },
            );
        }

        apCtx.sendActivity({ username: account.username }, 'followers', undo, {
            preferSharedInbox: true,
        });
        return new Response(JSON.stringify(undoJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    }
}
