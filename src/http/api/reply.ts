import {
    type Actor,
    Create,
    Image,
    Mention,
    Note,
    PUBLIC_COLLECTION,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { HonoContextVariables } from 'app';
import type { Context } from 'hono';
import { Post } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { GCPStorageService } from 'storage/gcloud-storage/gcp-storage.service';
import { v4 as uuidv4 } from 'uuid';
import z from 'zod';

import { fedify } from 'app';
import { getValue } from 'core/result';
import { exhaustiveCheck, getError, isError } from 'core/result';
import { addToList } from 'kv-helpers';
import { lookupActor, lookupObject } from 'lookup-helpers';
import type { PostService } from 'post/post.service';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';

const ReplyActionSchema = z.object({
    content: z.string(),
    imageUrl: z.string().url().optional(),
});

export function createReplyActionHandler(
    accountRepository: KnexAccountRepository,
    postService: PostService,
    postRepository: KnexPostRepository,
    storageService: GCPStorageService,
) {
    return async function replyAction(
        ctx: Context<{ Variables: HonoContextVariables }>,
    ) {
        const logger = ctx.get('logger');
        const id = ctx.req.param('id');

        let data: z.infer<typeof ReplyActionSchema>;

        try {
            data = ReplyActionSchema.parse((await ctx.req.json()) as unknown);
        } catch (err) {
            return new Response(JSON.stringify(err), { status: 400 });
        }

        // Verify image URL if provided
        if (data.imageUrl) {
            const result = await storageService.verifyImageUrl(
                new URL(data.imageUrl),
            );
            if (isError(result)) {
                const error = getError(result);
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
                    case 'gcs-error':
                        ctx.get('logger').error(
                            'GCS error verifying image URL',
                            {
                                url: data.imageUrl,
                            },
                        );
                        break;
                    default:
                        return exhaustiveCheck(error);
                }

                return new Response(JSON.stringify({ error: errorMessage }), {
                    status: 400,
                });
            }
        }

        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
            globaldb: ctx.get('globaldb'),
            logger,
        });

        const objectToReplyTo = await lookupObject(apCtx, id);
        if (!objectToReplyTo) {
            return new Response(null, {
                status: 404,
            });
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
            return new Response(null, {
                status: 400,
            });
        }

        const to = PUBLIC_COLLECTION;
        const cc = [
            attributionActor,
            apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
        ];

        const conversation =
            objectToReplyTo.replyTargetId || objectToReplyTo.id!;
        const mentions = [
            new Mention({
                href: attributionActor.id,
                name: attributionActor.name,
            }),
        ];

        const account = await accountRepository.getBySite(ctx.get('site'));

        if (!objectToReplyTo.id) {
            return new Response('Invalid Reply - no object to reply id', {
                status: 400,
            });
        }

        const parentPostResult = await postService.getByApId(
            objectToReplyTo.id,
        );

        if (isError(parentPostResult)) {
            const error = getError(parentPostResult);
            switch (error) {
                case 'upstream-error':
                    ctx.get('logger').info(
                        'Upstream error fetching parent post for reply',
                        {
                            postId: objectToReplyTo.id.href,
                        },
                    );
                    return new Response(
                        'Invalid Reply - upstream error fetching parent post',
                        {
                            status: 502,
                        },
                    );
                case 'not-a-post':
                    ctx.get('logger').info(
                        'Parent resource for reply is not a post',
                        {
                            postId: objectToReplyTo.id.href,
                        },
                    );
                    return new Response(
                        'Invalid Reply - parent is not a post',
                        {
                            status: 404,
                        },
                    );
                case 'missing-author':
                    ctx.get('logger').info(
                        'Parent post for reply has missing author',
                        {
                            postId: objectToReplyTo.id.href,
                        },
                    );
                    return new Response(
                        'Invalid Reply - parent post has no author',
                        {
                            status: 404,
                        },
                    );
                default:
                    return exhaustiveCheck(error);
            }
        }

        const parentPost = getValue(parentPostResult);

        const newReply = Post.createReply(
            account,
            data.content,
            parentPost,
            data.imageUrl ? new URL(data.imageUrl) : undefined,
        );

        await postRepository.save(newReply);

        const reply = new Note({
            id: newReply.apId,
            attribution: actor,
            replyTarget: objectToReplyTo,
            content: newReply.content,
            attachments: newReply.imageUrl
                ? [
                      new Image({
                          url: newReply.imageUrl,
                      }),
                  ]
                : undefined,
            summary: null,
            published: Temporal.Now.instant(),
            contexts: [conversation],
            tags: mentions,
            to: to,
            ccs: cc,
        });

        const createId = apCtx.getObjectUri(Create, {
            id: uuidv4(),
        });

        const create = new Create({
            id: createId,
            actor: actor,
            object: reply,
            to: to,
            ccs: cc,
        });

        const activityJson = await create.toJsonLd();

        await ctx.get('globaldb').set([create.id!.href], activityJson);
        await ctx.get('globaldb').set([reply.id!.href], await reply.toJsonLd());

        await addToList(ctx.get('db'), ['outbox'], create.id!.href);

        apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
            attributionActor,
            create,
            {
                preferSharedInbox: true,
            },
        );

        try {
            await apCtx.sendActivity(
                { handle: ACTOR_DEFAULT_HANDLE },
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
    };
}
