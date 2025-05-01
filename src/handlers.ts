import { createHash } from 'node:crypto';
import {
    type Actor,
    Announce,
    Like,
    PUBLIC_COLLECTION,
    Undo,
} from '@fedify/fedify';
import type { Context } from 'hono';

import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import { parseURL } from 'core/url';
import type { KnexAccountRepository } from './account/account.repository.knex';
import { type HonoContextVariables, fedify } from './app';
import { ACTOR_DEFAULT_HANDLE } from './constants';
import { buildActivity } from './helpers/activitypub/activity';
import { addToList, removeFromList } from './kv-helpers';
import { lookupActor, lookupObject } from './lookup-helpers';
import type { KnexPostRepository } from './post/post.repository.knex';
import type { PostService } from './post/post.service';
import type { SiteService } from './site/site.service';

export function createUnlikeAction(
    accountRepository: KnexAccountRepository,
    postService: PostService,
    postRepository: KnexPostRepository,
) {
    return async function unlikeAction(
        ctx: Context<{ Variables: HonoContextVariables }>,
    ) {
        const id = ctx.req.param('id');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
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

        const account = await accountRepository.getBySite(ctx.get('site'));
        if (account !== null) {
            const postResult = await postService.getByApId(idAsUrl);

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
                await postRepository.save(post);
            }
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

        await removeFromList(ctx.get('db'), ['liked'], likeId!.href);
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
                { handle: ACTOR_DEFAULT_HANDLE },
                attributionActor,
                undo,
                {
                    preferSharedInbox: true,
                },
            );
        }

        apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
            'followers',
            undo,
            {
                preferSharedInbox: true,
            },
        );
        return new Response(JSON.stringify(undoJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    };
}

export function createLikeAction(
    accountRepository: KnexAccountRepository,
    postService: PostService,
    postRepository: KnexPostRepository,
) {
    return async function likeAction(
        ctx: Context<{ Variables: HonoContextVariables }>,
    ) {
        const id = ctx.req.param('id');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
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

        const account = await accountRepository.getBySite(ctx.get('site'));
        if (account !== null) {
            const postResult = await postService.getByApId(idAsUrl);

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
                post.addLike(account);
                await postRepository.save(post);
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

        await addToList(ctx.get('db'), ['liked'], like.id!.href);

        let attributionActor: Actor | null = null;
        if (objectToLike.attributionId) {
            attributionActor = await lookupActor(
                apCtx,
                objectToLike.attributionId.href,
            );
        }
        if (attributionActor) {
            apCtx.sendActivity(
                { handle: ACTOR_DEFAULT_HANDLE },
                attributionActor,
                like,
                {
                    preferSharedInbox: true,
                },
            );
        }

        apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
            'followers',
            like,
            {
                preferSharedInbox: true,
            },
        );
        return new Response(JSON.stringify(likeJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    };
}

export const getSiteDataHandler =
    (siteService: SiteService) =>
    async (ctx: Context<{ Variables: HonoContextVariables }>) => {
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            ctx.get('logger').info('No Host header');
            return new Response(JSON.stringify({ error: 'No Host header' }), {
                status: 401,
            });
        }

        const site = await siteService.initialiseSiteForHost(host);

        return new Response(JSON.stringify(site), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    };

export async function inboxHandler(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const globaldb = ctx.get('globaldb');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb,
        logger,
    });

    // Fetch the liked items from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    // This is used to add a "liked" property to the item if the user has liked it
    const liked = (await db.get<string[]>(['liked'])) || [];

    // Fetch the reposted items from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    // This is used to add a "reposted" property to the item if the user has reposted it
    const reposted = (await db.get<string[]>(['reposted'])) || [];

    // Fetch the outbox from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    // This is used to add a "authored" property to the item if the user has authored it
    const outbox = (await db.get<string[]>(['outbox'])) || [];

    // Fetch the inbox from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    const inbox = (await db.get<string[]>(['inbox'])) || [];

    // Prepare the items for the response
    const items = await Promise.all(
        inbox.map(async (item) => {
            try {
                return await buildActivity(
                    item,
                    globaldb,
                    apCtx,
                    liked,
                    reposted,
                    outbox,
                    {
                        expandInReplyTo: false,
                        showReplyCount: true,
                        showRepostCount: true,
                    },
                );
            } catch (err) {
                ctx.get('logger').error('Inbox handler failed: {error}', {
                    error: err,
                });
                return null;
            }
        }),
    ).then((results) => results.filter(Boolean));

    // Return the prepared inbox items
    return new Response(
        JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollection',
            totalItems: inbox.length,
            items,
        }),
        {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        },
    );
}

export function createRepostActionHandler(
    accountRepository: KnexAccountRepository,
    postService: PostService,
    postRepository: KnexPostRepository,
) {
    return async function repostAction(
        ctx: Context<{ Variables: HonoContextVariables }>,
    ) {
        const id = ctx.req.param('id');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
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

        if (await ctx.get('globaldb').get([announceId.href])) {
            return new Response(
                JSON.stringify({ error: 'Post already reposted' }),
                {
                    status: 409,
                },
            );
        }

        await post.getAttribution();

        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

        if (!post.id) {
            ctx.get('logger').info('Invalid Repost - no post id');
            return;
        }

        const account = await accountRepository.getBySite(ctx.get('site'));
        if (account !== null) {
            const originalPostResult = await postService.getByApId(post.id);
            if (!isError(originalPostResult)) {
                const originalPost = getValue(originalPostResult);
                originalPost.addRepost(account);
                await postRepository.save(originalPost);
            }
        }

        const announce = new Announce({
            id: announceId,
            actor: actor,
            object: post,
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
        });

        const announceJson = await announce.toJsonLd();

        // Add announce activity to the database
        await ctx.get('globaldb').set([announce.id!.href], announceJson);
        await addToList(ctx.get('db'), ['reposted'], announce.id!.href);

        // Add announce activity to the actor's outbox
        await addToList(ctx.get('db'), ['outbox'], announce.id!.href);

        // Send the announce activity
        let attributionActor: Actor | null = null;
        if (post.attributionId) {
            attributionActor = await lookupActor(
                apCtx,
                post.attributionId.href,
            );
        }
        if (attributionActor) {
            apCtx.sendActivity(
                { handle: ACTOR_DEFAULT_HANDLE },
                attributionActor,
                announce,
                {
                    preferSharedInbox: true,
                },
            );
        }

        apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
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
    };
}

export function createDerepostActionHandler(
    accountRepository: KnexAccountRepository,
    postService: PostService,
    postRepository: KnexPostRepository,
) {
    return async function derepostAction(
        ctx: Context<{ Variables: HonoContextVariables }>,
    ) {
        const id = ctx.req.param('id');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
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

        const account = await accountRepository.getBySite(ctx.get('site'));
        const originalPostResult = await postService.getByApId(idAsUrl);

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
            await postRepository.save(originalPost);
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
        await removeFromList(ctx.get('db'), ['reposted'], announceId.href);
        await ctx.get('globaldb').delete([announceId.href]);

        // Remove announce activity from the actor's outbox
        await removeFromList(ctx.get('db'), ['outbox'], announceId.href);

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
                { handle: ACTOR_DEFAULT_HANDLE },
                attributionActor,
                undo,
                {
                    preferSharedInbox: true,
                },
            );
        }

        apCtx.sendActivity(
            { handle: ACTOR_DEFAULT_HANDLE },
            'followers',
            undo,
            {
                preferSharedInbox: true,
            },
        );

        return new Response(JSON.stringify(undoJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    };
}
