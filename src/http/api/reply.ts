import {
    type Actor,
    Create,
    Image,
    Mention,
    Note,
    PUBLIC_COLLECTION,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import z from 'zod';

import { type AppContext, fedify } from 'app';
import { getValue } from 'core/result';
import { exhaustiveCheck, getError, isError } from 'core/result';
import { parseURL } from 'core/url';
import { addToList } from 'kv-helpers';
import { lookupActor, lookupObject } from 'lookup-helpers';
import type { PostService } from 'post/post.service';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';

const ReplyActionSchema = z.object({
    content: z.string(),
    imageUrl: z.string().url().optional(),
});

export async function handleCreateReply(
    ctx: AppContext,
    postService: PostService,
) {
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

    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
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
    const cc = [attributionActor, apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE)];

    const conversation = objectToReplyTo.replyTargetId || objectToReplyTo.id!;
    const mentions = [
        new Mention({
            href: attributionActor.id,
            name: attributionActor.name,
        }),
    ];

    const newReplyResult = await postService.createReply(
        ctx.get('account'),
        data.content,
        inReplyToId,
        data.imageUrl ? new URL(data.imageUrl) : undefined,
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
            case 'gcs-error':
                ctx.get('logger').error('GCS error verifying image URL', {
                    url: data.imageUrl,
                });
                return new Response(
                    JSON.stringify({ error: 'Error verifying image URL' }),
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
}
