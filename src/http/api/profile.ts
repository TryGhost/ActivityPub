import { createHash } from 'node:crypto';
import {
    Activity,
    Announce,
    Like,
    isActor,
    type Actor,
    type CollectionPage,
} from '@fedify/fedify';

import type { AccountService } from '../../account/account.service';
import { type AppContext, fedify } from '../../app';
import { getActivityChildrenCount, getRepostCount } from '../../db';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    isFollowedByDefaultSiteAccount,
    isHandle,
} from '../../helpers/activitypub/actor';
import { sanitizeHtml } from '../../helpers/html';
import { isUri } from '../../helpers/uri';
import { lookupObject } from '../../lookup-helpers';

interface Profile {
    actor: any;
    handle: string;
    followerCount: number;
    followingCount: number;
    isFollowing: boolean;
}

/**
 * Create a handler for a request for a profile
 *
 * @param accountService Account service instance
 */
export function createGetProfileHandler(accountService: AccountService) {
    /**
     * Handle a request for a profile
     *
     * @param ctx App context instance
     */
    return async function handleGetProfile(ctx: AppContext) {
        const db = ctx.get('db');
        const logger = ctx.get('logger');
        const site = ctx.get('site');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger,
        });

        // Parse "handle" from request parameters
        // /profile/:handle
        const handle = ctx.req.param('handle') || '';

        // If the provided handle is invalid, return early
        if (isHandle(handle) === false) {
            return new Response(null, { status: 400 });
        }

        // Lookup actor by handle
        const result: Profile = {
            actor: {},
            handle: '',
            followerCount: 0,
            followingCount: 0,
            isFollowing: false,
        };

        try {
            const actor = await lookupObject(apCtx, handle);

            if (!isActor(actor)) {
                return new Response(null, { status: 404 });
            }

            result.actor = await actor.toJsonLd();
            result.actor.summary = sanitizeHtml(result.actor.summary);
            result.handle = getHandle(actor);

            const [
                followerCount,
                followingCount,
                isFollowingResult,
                attachments,
            ] = await Promise.all([
                getFollowerCount(actor),
                getFollowingCount(actor),
                isFollowedByDefaultSiteAccount(actor, site, accountService),
                getAttachments(actor, {
                    sanitizeValue: (value: string) => sanitizeHtml(value),
                }),
            ]);

            result.followerCount = followerCount;
            result.followingCount = followingCount;
            result.isFollowing = isFollowingResult;
            result.actor.attachment = attachments;
        } catch (err) {
            logger.error('Profile retrieval failed ({handle}): {error}', {
                handle,
                error: err,
            });

            return new Response(null, { status: 500 });
        }

        // Return results
        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };
}

interface PostsResult {
    posts: any[];
    next: string | null;
}

/**
 * Create a handler for a request for a profile's posts
 *
 * @param accountService Account service instance
 */
export function createGetProfilePostsHandler(accountService: AccountService) {
    /**
     * Handle a request for a profile's posts
     *
     * @param ctx App context instance
     */
    return async function handleGetProfilePosts(ctx: AppContext) {
        const db = ctx.get('db');
        const logger = ctx.get('logger');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger,
        });
        const defaultSiteAccount =
            await accountService.getDefaultAccountForSite(ctx.get('site'));

        // Parse "handle" from request parameters
        // /profile/:handle/posts
        const handle = ctx.req.param('handle') || '';

        // If the provided handle is invalid, return early
        if (!isHandle(handle)) {
            return new Response(null, { status: 400 });
        }

        // Parse "next" from query parameters
        // /profile/:handle/posts?next=<string>
        const queryNext = ctx.req.query('next') || '';
        const next = queryNext ? decodeURIComponent(queryNext) : '';

        // If the next parameter is not a valid URI, return early
        if (next !== '' && !isUri(next)) {
            return new Response(null, { status: 400 });
        }

        // Lookup actor by handle
        const actor = await lookupObject(apCtx, handle);

        if (!isActor(actor)) {
            return new Response(null, { status: 404 });
        }

        // Retrieve actor's posts
        // If a next parameter was provided, use it to retrieve a specific page of
        // posts. Otherwise, retrieve the first page of posts
        const result: PostsResult = {
            posts: [],
            next: null,
        };

        let page: CollectionPage | null = null;

        try {
            if (next !== '') {
                // Ensure the next parameter is for the same host as the actor. We
                // do this to prevent blindly passing URIs to lookupObject (i.e next
                // param has been tampered with)
                // @TODO: Does this provide enough security? Can the host of the
                // actor be different to the host of the actor's followers collection?
                const { host: actorHost } = actor?.id || new URL('');
                const { host: nextHost } = new URL(next);

                if (actorHost !== nextHost) {
                    return new Response(null, { status: 400 });
                }

                page = (await lookupObject(
                    apCtx,
                    next,
                )) as CollectionPage | null;

                // Explicitly check that we have a valid page seeming though we
                // can't be type safe due to lookupObject returning a generic object
                if (!page?.itemIds) {
                    page = null;
                }
            } else {
                const outbox = await actor.getOutbox();

                if (outbox) {
                    page = await outbox.getFirst();
                }
            }
        } catch (err) {
            logger.error('Error getting outbox', { error: err });
        }

        if (!page) {
            return new Response(null, { status: 404 });
        }

        // Return result
        try {
            for await (const item of page.getItems()) {
                if (!(item instanceof Activity)) {
                    continue;
                }

                const object = await item.getObject();
                const attributedTo = await object?.getAttribution();

                const activity = (await item.toJsonLd({
                    format: 'compact',
                })) as any;

                if (activity?.object?.content) {
                    activity.object.content = sanitizeHtml(
                        activity.object.content,
                    );
                }

                activity.object.authored =
                    defaultSiteAccount.ap_id === activity.actor.id;

                // Add reply count and repost count to the object, if it is an object
                if (typeof activity.object !== 'string') {
                    activity.object.replyCount =
                        await getActivityChildrenCount(activity);
                    activity.object.repostCount =
                        await getRepostCount(activity);

                    // Check if the activity is liked or reposted by default site account
                    const objectId = activity.object.id;
                    if (objectId) {
                        const likeId = apCtx.getObjectUri(Like, {
                            id: createHash('sha256')
                                .update(objectId)
                                .digest('hex'),
                        });
                        const repostId = apCtx.getObjectUri(Announce, {
                            id: createHash('sha256')
                                .update(objectId)
                                .digest('hex'),
                        });

                        const liked = (await db.get<string[]>(['liked'])) || [];

                        const reposted =
                            (await db.get<string[]>(['reposted'])) || [];

                        activity.object.liked = liked.includes(likeId.href);
                        activity.object.reposted = reposted.includes(
                            repostId.href,
                        );
                    }
                }

                if (typeof activity.actor === 'string') {
                    activity.actor = await actor.toJsonLd({
                        format: 'compact',
                    });
                }

                result.posts.push(activity);
            }
        } catch (err) {
            logger.error('Error getting posts', { error: err });
        }

        result.next = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };
}

interface FollowersResult {
    followers: {
        actor: any;
        isFollowing: boolean;
    }[];
    next: string | null;
}

/**
 * Create a handler for a request for a profile's followers
 *
 * @param accountService Account service instance
 */
export function createGetProfileFollowersHandler(
    accountService: AccountService,
) {
    /**
     * Handle a request for a profile's followers
     *
     * @param ctx App context instance
     */
    return async function handleGetProfileFollowers(ctx: AppContext) {
        const db = ctx.get('db');
        const logger = ctx.get('logger');
        const site = ctx.get('site');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger,
        });

        // Parse "handle" from request parameters
        // /profile/:handle/followers
        const handle = ctx.req.param('handle') || '';

        // If the provided handle is invalid, return early
        if (!isHandle(handle)) {
            return new Response(null, { status: 400 });
        }

        // Parse "next" from query parameters
        // /profile/:handle/followers?next=<string>
        const queryNext = ctx.req.query('next') || '';
        const next = queryNext ? decodeURIComponent(queryNext) : '';

        // If the next parameter is not a valid URI, return early
        if (next !== '' && !isUri(next)) {
            return new Response(null, { status: 400 });
        }

        // Lookup actor by handle
        const actor = await lookupObject(apCtx, handle);

        if (!isActor(actor)) {
            return new Response(null, { status: 404 });
        }

        // Retrieve actor's followers
        // If a next parameter was provided, use it to retrieve a specific page of
        // followers. Otherwise, retrieve the first page of followers
        const result: FollowersResult = {
            followers: [],
            next: null,
        };

        let page: CollectionPage | null = null;

        try {
            if (next !== '') {
                // Ensure the next parameter is for the same host as the actor. We
                // do this to prevent blindly passing URIs to lookupObject (i.e next
                // param has been tampered with)
                // @TODO: Does this provide enough security? Can the host of the
                // actor be different to the host of the actor's followers collection?
                const { host: actorHost } = actor?.id || new URL('');
                const { host: nextHost } = new URL(next);

                if (actorHost !== nextHost) {
                    return new Response(null, { status: 400 });
                }

                page = (await lookupObject(
                    apCtx,
                    next,
                )) as CollectionPage | null;

                // Explicitly check that we have a valid page seeming though we
                // can't be type safe due to lookupObject returning a generic object
                if (!page?.itemIds) {
                    page = null;
                }
            } else {
                const followers = await actor.getFollowers();

                if (followers) {
                    page = await followers.getFirst();
                }
            }
        } catch (err) {
            logger.error('Error getting followers', { error: err });
        }

        if (!page) {
            return new Response(null, { status: 404 });
        }

        // Return result
        try {
            for await (const item of page.getItems()) {
                result.followers.push({
                    actor: await item.toJsonLd({ format: 'compact' }),
                    isFollowing: await isFollowedByDefaultSiteAccount(
                        item as Actor,
                        site,
                        accountService,
                    ),
                });
            }
        } catch (err) {
            logger.error('Error getting followers', { error: err });
        }

        result.next = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };
}

interface FollowingResult {
    following: {
        actor: any;
        isFollowing: boolean;
    }[];
    next: string | null;
}

/**
 * Create a handler for a request for a profile's following
 *
 * @param accountService Account service instance
 */
export function createGetProfileFollowingHandler(
    accountService: AccountService,
) {
    /**
     * Handle a request for a profile's following
     *
     * @param ctx App context instance
     */
    return async function handleGetProfileFollowing(ctx: AppContext) {
        const db = ctx.get('db');
        const logger = ctx.get('logger');
        const site = ctx.get('site');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger,
        });

        // Parse "handle" from request parameters
        // /profile/:handle/following
        const handle = ctx.req.param('handle') || '';

        // If the provided handle is invalid, return early
        if (!isHandle(handle)) {
            return new Response(null, { status: 400 });
        }

        // Parse "next" from query parameters
        // /profile/:handle/following?next=<string>
        const queryNext = ctx.req.query('next') || '';
        const next = queryNext ? decodeURIComponent(queryNext) : '';

        // If the next parameter is not a valid URI, return early
        if (next !== '' && !isUri(next)) {
            return new Response(null, { status: 400 });
        }

        // Lookup actor by handle
        const actor = await lookupObject(apCtx, handle);

        if (!isActor(actor)) {
            return new Response(null, { status: 404 });
        }

        // Retrieve actor's following
        // If a next parameter was provided, use it to retrieve a specific page of
        // the actor's following. Otherwise, retrieve the first page of the actor's
        // following
        const result: FollowingResult = {
            following: [],
            next: null,
        };

        let page: CollectionPage | null = null;

        try {
            if (next !== '') {
                // Ensure the next parameter is for the same host as the actor. We
                // do this to prevent blindly passing URIs to lookupObject (i.e next
                // param has been tampered with)
                // @TODO: Does this provide enough security? Can the host of the
                // actor be different to the host of the actor's following collection?
                const { host: actorHost } = actor?.id || new URL('');
                const { host: nextHost } = new URL(next);

                if (actorHost !== nextHost) {
                    return new Response(null, { status: 400 });
                }

                page = (await lookupObject(
                    apCtx,
                    next,
                )) as CollectionPage | null;

                // Explicitly check that we have a valid page seeming though we
                // can't be type safe due to lookupObject returning a generic object
                if (!page?.itemIds) {
                    page = null;
                }
            } else {
                const following = await actor.getFollowing();

                if (following) {
                    page = await following.getFirst();
                }
            }
        } catch (err) {
            logger.error('Error getting following', { error: err });
        }

        if (!page) {
            return new Response(null, { status: 404 });
        }

        // Return result
        try {
            for await (const item of page.getItems()) {
                result.following.push({
                    actor: await item.toJsonLd({ format: 'compact' }),
                    isFollowing: await isFollowedByDefaultSiteAccount(
                        item as Actor,
                        site,
                        accountService,
                    ),
                });
            }
        } catch (err) {
            logger.error('Error getting following', { error: err });
        }

        result.next = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };
}
