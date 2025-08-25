import { createHash } from 'node:crypto';

import {
    type Actor,
    Announce,
    Create,
    type Federation,
    Image,
    Mention,
    Note,
    PUBLIC_COLLECTION,
    Undo,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import type { AppContext, ContextData } from '@/app';
import { ACTOR_DEFAULT_HANDLE } from '@/constants';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import { parseURL } from '@/core/url';
import { getRelatedActivities } from '@/db';
import { buildAnnounceActivityForPost } from '@/helpers/activitypub/activity';
import { getHandle } from '@/helpers/activitypub/actor';
import { postToDTO } from '@/http/api/helpers/post';
import {
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
} from '@/http/api/helpers/response';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import { lookupActor, lookupObject } from '@/lookup-helpers';
import type { ImageAttachment } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { PostService } from '@/post/post.service';

/**
 * Controller for post-related operations
 */
export class PostController {
    constructor(
        private readonly postService: PostService,
        private readonly accountService: AccountService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly postRepository: KnexPostRepository,
        private readonly fedify: Federation<ContextData>,
    ) {}

    /**
     * Handle a request to get a post
     */
    @APIRoute('GET', 'post/:post_ap_id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
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
    @APIRoute('DELETE', 'post/:id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
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
        const deleteResult = await this.postService.deleteByApId(
            idAsUrl,
            account,
        );

        if (isError(deleteResult)) {
            const error = getError(deleteResult);
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
                case 'not-author':
                    logger.info(
                        `Can't delete post ${idAsUrl.href} because ${account.id} is not the author of the post`,
                    );
                    return new Response(null, { status: 403 });
                default:
                    return exhaustiveCheck(error);
            }
        }

        try {
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
    @APIRoute('POST', 'actions/note')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
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
        } catch (_err) {
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
    @APIRoute('POST', 'actions/reply/:id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleCreateReply(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');
        const id = ctx.req.param('id');

        const ReplyActionSchema = z.object({
            content: z.string(),
            image: z
                .object({
                    url: z.string().url(),
                    altText: z.string().optional(),
                })
                .optional(),
            imageUrl: z.string().url().optional(),
        });

        let data: z.infer<typeof ReplyActionSchema>;

        try {
            data = ReplyActionSchema.parse((await ctx.req.json()) as unknown);
        } catch (_err) {
            return new Response(
                JSON.stringify({ error: 'Invalid request format' }),
                { status: 400 },
            );
        }

        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger,
        });

        const inReplyToId = parseURL(decodeURIComponent(id));

        if (!inReplyToId) {
            return new Response(
                JSON.stringify({ error: 'ID should be a valid URL' }),
                {
                    status: 400,
                },
            );
        }

        const objectToReplyTo = await lookupObject(apCtx, id);
        if (!objectToReplyTo) {
            return new Response(
                JSON.stringify({ error: 'Object to reply to not found' }),
                {
                    status: 404,
                },
            );
        }

        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE);

        let attributionActor: Actor | null = null;
        if (objectToReplyTo.attributionId) {
            attributionActor = await lookupActor(
                apCtx,
                objectToReplyTo.attributionId.href,
            );
        }

        if (!attributionActor) {
            return new Response(
                JSON.stringify({ error: 'Attribution actor not found' }),
                {
                    status: 400,
                },
            );
        }

        const to = PUBLIC_COLLECTION;

        const conversation =
            objectToReplyTo.replyTargetId || objectToReplyTo.id!;
        const mentions = [
            new Mention({
                href: attributionActor.id,
                name: getHandle(attributionActor),
            }),
        ];

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

        const newReplyResult = await this.postService.createReply(
            account,
            data.content,
            inReplyToId,
            image,
        );

        if (isError(newReplyResult)) {
            const error = getError(newReplyResult);
            switch (error) {
                case 'upstream-error':
                    ctx.get('logger').info(
                        'Upstream error fetching parent post for reply',
                        {
                            postId: inReplyToId.href,
                        },
                    );
                    return new Response(
                        JSON.stringify({
                            error: 'Invalid Reply - upstream error fetching parent post',
                        }),
                        {
                            status: 502,
                        },
                    );
                case 'not-a-post':
                    ctx.get('logger').info(
                        'Parent resource for reply is not a post',
                        {
                            postId: inReplyToId.href,
                        },
                    );
                    return new Response(
                        JSON.stringify({
                            error: 'Invalid Reply - parent is not a post',
                        }),
                        {
                            status: 404,
                        },
                    );
                case 'missing-author':
                    ctx.get('logger').info(
                        'Parent post for reply has missing author',
                        {
                            postId: inReplyToId.href,
                        },
                    );
                    return new Response(
                        JSON.stringify({
                            error: 'Invalid Reply - parent post has no author',
                        }),
                        {
                            status: 404,
                        },
                    );
                case 'invalid-url':
                    return new Response(
                        JSON.stringify({ error: 'Invalid image URL format' }),
                        {
                            status: 400,
                        },
                    );
                case 'invalid-file-path':
                    return new Response(
                        JSON.stringify({ error: 'Invalid image file path' }),
                        {
                            status: 400,
                        },
                    );
                case 'file-not-found':
                    return new Response(
                        JSON.stringify({ error: 'Image not found in storage' }),
                        {
                            status: 400,
                        },
                    );
                case 'cannot-interact':
                    return new Response(
                        JSON.stringify({
                            error: 'Cannot interact with this account',
                        }),
                        {
                            status: 403,
                        },
                    );
                default:
                    return exhaustiveCheck(error);
            }
        }

        const newReply = getValue(newReplyResult);
        const replyMentions = newReply.mentions.map(
            (mentionedAccount) =>
                new Mention({
                    name: `@${mentionedAccount.username}@${mentionedAccount.apId.hostname}`,
                    href: mentionedAccount.apId,
                }),
        );
        mentions.push(...replyMentions);

        const cc = [
            apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
            ...mentions
                .map((mention) => mention.href)
                .filter((href) => href !== null),
        ];

        const reply = new Note({
            id: newReply.apId,
            attribution: actor,
            replyTarget: objectToReplyTo,
            content: newReply.content,
            attachments: newReply.attachments
                ? newReply.attachments
                      .filter((attachment) => attachment.type === 'Image')
                      .map(
                          (attachment) =>
                              new Image({
                                  url: attachment.url,
                                  name: attachment.name,
                              }),
                      )
                : undefined,
            summary: null,
            published: Temporal.Now.instant(),
            contexts: [conversation],
            tags: mentions,
            to: to,
            ccs: cc,
        });

        const create = new Create({
            id: apCtx.getObjectUri(Create, { id: newReply.uuid }),
            actor: actor,
            object: reply,
            to: to,
            ccs: cc,
        });

        const activityJson = await create.toJsonLd();

        await ctx.get('globaldb').set([create.id!.href], activityJson);
        await ctx.get('globaldb').set([reply.id!.href], await reply.toJsonLd());

        apCtx.sendActivity(
            { username: account.username },
            attributionActor,
            create,
            {
                preferSharedInbox: true,
            },
        );

        try {
            await apCtx.sendActivity(
                { username: account.username },
                'followers',
                create,
                {
                    preferSharedInbox: true,
                },
            );
        } catch (err) {
            logger.error('Error sending reply activity - {error}', {
                error: err,
            });
        }

        return new Response(JSON.stringify(activityJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    }

    /**
     * Handle a request to repost
     */
    @APIRoute('POST', 'actions/repost/:id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleRepost(ctx: AppContext): Promise<Response> {
        const id = ctx.req.param('id');
        const apId = parseURL(id);

        if (apId === null) {
            return BadRequest('Could not parse id as URL');
        }

        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const account = ctx.get('account');
        const postResult = await this.postService.repostByApId(account, apId);

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'already-reposted':
                    return Conflict('Already reposted');
                case 'upstream-error':
                    return NotFound('Upstream error fetching post');
                case 'not-a-post':
                    return BadRequest('Not a post');
                case 'missing-author':
                    return NotFound('Post does not have an author');
                case 'cannot-interact':
                    return Forbidden('Cannot interact with this account');
                default:
                    exhaustiveCheck(error);
            }
        }

        const post = getValue(postResult);

        const announce = await buildAnnounceActivityForPost(
            account,
            post,
            apCtx,
        );

        const announceJson = await announce.toJsonLd();

        // Add announce activity to the database
        await ctx.get('globaldb').set([announce.id!.href], announceJson);

        await apCtx.sendActivity(
            { username: account.username },
            {
                id: post.author.apId,
                inboxId: post.author.apInbox,
            },
            announce,
            {
                preferSharedInbox: true,
            },
        );

        await apCtx.sendActivity(
            { username: account.username },
            'followers',
            announce,
            {
                preferSharedInbox: true,
            },
        );

        return new Response(JSON.stringify(announceJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    }

    /**
     * Handle a request to derepost
     */
    @APIRoute('POST', 'actions/derepost/:id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleDerepost(ctx: AppContext) {
        const account = ctx.get('account');
        const id = ctx.req.param('id');
        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const post = await lookupObject(apCtx, id);
        if (!post) {
            return new Response(JSON.stringify({ error: 'Post not found' }), {
                status: 404,
            });
        }

        const announceId = apCtx.getObjectUri(Announce, {
            id: createHash('sha256').update(post.id!.href).digest('hex'),
        });

        const undoId = apCtx.getObjectUri(Undo, {
            id: createHash('sha256').update(announceId.href).digest('hex'),
        });

        const announceToUndoJson = await ctx
            .get('globaldb')
            .get([announceId.href]);

        if (!announceToUndoJson) {
            return new Response(
                JSON.stringify({ error: 'Repost activity not found' }),
                {
                    status: 409,
                },
            );
        }

        const announceToUndo = await Announce.fromJsonLd(announceToUndoJson);

        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

        const idAsUrl = parseURL(id);

        if (!idAsUrl) {
            return new Response(
                JSON.stringify({ error: 'ID should be a valid URL' }),
                {
                    status: 400,
                },
            );
        }

        const originalPostResult = await this.postService.getByApId(idAsUrl);

        if (isError(originalPostResult)) {
            const error = getError(originalPostResult);
            switch (error) {
                case 'upstream-error':
                    ctx.get('logger').info(
                        'Upstream error fetching post for dereposting',
                        { postId: idAsUrl.href },
                    );
                    break;
                case 'not-a-post':
                    ctx.get('logger').info(
                        'Resource for dereposting is not a post',
                        { postId: idAsUrl.href },
                    );
                    break;
                case 'missing-author':
                    ctx.get('logger').info(
                        'Post for dereposting has missing author',
                        { postId: idAsUrl.href },
                    );
                    break;
                default:
                    return exhaustiveCheck(error);
            }
        } else {
            const originalPost = getValue(originalPostResult);
            originalPost.removeRepost(account);
            await this.postRepository.save(originalPost);
        }

        const undo = new Undo({
            id: undoId,
            actor: actor,
            object: announceToUndo,
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
        });

        // Add the undo activity to the database
        const undoJson = await undo.toJsonLd();
        await ctx.get('globaldb').set([undo.id!.href], undoJson);

        // Remove announce activity from database
        await ctx.get('globaldb').delete([announceId.href]);

        // Send the undo activity
        let attributionActor: Actor | null = null;
        if (post.attributionId) {
            attributionActor = await lookupActor(
                apCtx,
                post.attributionId.href,
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
