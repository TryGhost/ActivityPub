import { createHash } from 'node:crypto';
import {
    type Actor,
    Announce,
    Create,
    Image,
    Mention,
    Note,
    PUBLIC_COLLECTION,
    Undo,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import type { AppContext } from 'app';
import { globalFedify } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import { parseURL } from 'core/url';
import { getRelatedActivities } from 'db';
import { buildAnnounceActivityForPost } from 'helpers/activitypub/activity';
import { getHandle } from 'helpers/activitypub/actor';
import { lookupActor, lookupObject } from 'lookup-helpers';
import type { ModerationService } from 'moderation/moderation.service';
import type { ImageAttachment } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import { z } from 'zod';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { postToDTO } from './helpers/post';
import { BadRequest, Conflict, Forbidden, NotFound } from './helpers/response';
import type { ReplyChainView } from './views/reply.chain.view';

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

const NoteActionSchema = z.object({
    content: z.string(),
    image: z
        .object({
            url: z.string().url(),
            altText: z.string().optional(),
        })
        .optional(),
    imageUrl: z.string().url().optional(),
});

export class PostController {
    constructor(
        private readonly postService: PostService,
        private readonly postRepository: KnexPostRepository,
        private readonly accountService: AccountService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly replyChainView: ReplyChainView,
        private readonly moderationService: ModerationService,
    ) {}

    /**
     * Handle a request to create a note
     */
    async handleCreateNote(ctx: AppContext) {
        const account = ctx.get('account');
        const logger = ctx.get('logger');

        let data: z.infer<typeof NoteActionSchema>;

        try {
            data = NoteActionSchema.parse((await ctx.req.json()) as unknown);
        } catch (err) {
            return BadRequest('Invalid request format');
        }

        const apCtx = globalFedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger,
        });

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

        const newNoteResult = await this.postService.createNote(
            account,
            data.content,
            image,
        );

        if (isError(newNoteResult)) {
            const error = getError(newNoteResult);
            switch (error) {
                case 'invalid-url':
                    return BadRequest('Invalid image URL format');
                case 'invalid-file-path':
                    return BadRequest('Invalid image file path');
                case 'file-not-found':
                    return BadRequest('Image not found in storage');
                default:
                    return exhaustiveCheck(error);
            }
        }

        const newNote = getValue(newNoteResult);
        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE);

        const note = new Note({
            id: newNote.apId,
            attribution: actor,
            content: newNote.content,
            attachments: newNote.attachments
                ? newNote.attachments
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
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
        });

        const create = new Create({
            id: apCtx.getObjectUri(Create, { id: newNote.uuid }),
            actor: actor,
            object: note,
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
        });

        const activityJson = await create.toJsonLd();

        await ctx.get('globaldb').set([create.id!.href], activityJson);
        await ctx.get('globaldb').set([note.id!.href], await note.toJsonLd());

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
            logger.error('Error sending create activity - {error}', {
                error: err,
            });
        }

        const postDTO = postToDTO(newNote, {
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
        const account = ctx.get('account');
        const logger = ctx.get('logger');
        const id = ctx.req.param('id');

        let data: z.infer<typeof ReplyActionSchema>;

        try {
            data = ReplyActionSchema.parse((await ctx.req.json()) as unknown);
        } catch (err) {
            return new Response(
                JSON.stringify({ error: 'Invalid request format' }),
                { status: 400 },
            );
        }

        const apCtx = globalFedify.createContext(ctx.req.raw as Request, {
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
     * Handle a request to repost a post
     */
    async handleRepost(ctx: AppContext): Promise<Response> {
        const id = ctx.req.param('id');
        const apId = parseURL(id);

        if (apId === null) {
            return BadRequest('Could not parse id as URL');
        }

        const apCtx = globalFedify.createContext(ctx.req.raw as Request, {
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
     * Handle a request to undo a repost
     */
    async handleDerepost(ctx: AppContext) {
        const account = ctx.get('account');
        const id = ctx.req.param('id');
        const apCtx = globalFedify.createContext(ctx.req.raw as Request, {
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

    /**
     * Handle a request to get replies to a post
     */
    async handleGetReplies(ctx: AppContext) {
        const postApId = decodeURIComponent(ctx.req.param('post_ap_id'));
        const account = ctx.get('account');

        const replyChainResult = await this.replyChainView.getReplyChain(
            account.id,
            new URL(postApId),
            ctx.req.query('next'),
        );

        if (isError(replyChainResult)) {
            const error = getError(replyChainResult);
            switch (error) {
                case 'not-found':
                    return NotFound('Post not found');
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(JSON.stringify(getValue(replyChainResult)), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }
}
