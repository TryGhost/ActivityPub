import { isActor } from '@fedify/fedify';

import type { AccountService } from '../../account/account.service';
import { type AppContext, fedify } from '../../app';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    isFollowedByDefaultSiteAccount,
    isHandle,
} from '../../helpers/activitypub/actor';
import { sanitizeHtml } from '../../helpers/html';
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
