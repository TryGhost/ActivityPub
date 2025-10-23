import { type Federation, Follow, isActor, Undo } from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { AccountService } from '@/account/account.service';
import type { AppContext, ContextData } from '@/app';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import {
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
} from '@/http/api/helpers/response';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import {
    lookupActor,
    lookupActorProfile,
    lookupObject,
} from '@/lookup-helpers';
import type { ModerationService } from '@/moderation/moderation.service';

export class FollowController {
    constructor(
        private readonly accountService: AccountService,
        private readonly moderationService: ModerationService,
        private readonly fedify: Federation<ContextData>,
    ) {}

    @APIRoute('POST', 'actions/follow/:handle')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleFollow(ctx: AppContext) {
        const handle = ctx.req.param('handle');
        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });
        const followerAccount = ctx.get('account');

        // Retrieve the AP ID of the account to follow
        const lookupResult = await lookupActorProfile(apCtx, handle);

        if (isError(lookupResult)) {
            ctx.get('logger').error(
                `Failed to lookup apId for handle: ${handle}, error: ${getError(lookupResult)}`,
            );
            return NotFound('Remote account could not be found');
        }

        const accountToFollowApId = getValue(lookupResult);

        // We cannot follow ourselves
        if (accountToFollowApId.href === followerAccount.apId.href) {
            return BadRequest('Cannot follow yourself');
        }

        // Ensure the account to follow exists
        const getAccountToFollowResult = await this.accountService.ensureByApId(
            new URL(accountToFollowApId),
        );

        if (isError(getAccountToFollowResult)) {
            const error = getError(getAccountToFollowResult);
            switch (error) {
                case 'not-found':
                    return NotFound('Remote account could not be found');
                case 'invalid-type':
                    return BadRequest('Remote account is not an Actor');
                case 'invalid-data':
                    return BadRequest('Remote account could not be parsed');
                case 'network-failure':
                    return NotFound('Remote account could not be fetched');
                default:
                    return exhaustiveCheck(error);
            }
        }

        const accountToFollow = getValue(getAccountToFollowResult);

        // Check we can follow the account
        if (
            !(await this.moderationService.canInteractWithAccount(
                followerAccount.id,
                accountToFollow.id,
            ))
        ) {
            return Forbidden('You cannot follow this account');
        }

        // Check if we are already following the account
        if (
            await this.accountService.checkIfAccountIsFollowing(
                followerAccount.id,
                accountToFollow.id,
            )
        ) {
            return Conflict('Already following this account');
        }

        const actor = await lookupActor(apCtx, followerAccount.apId.toString());
        const actorToFollow = await lookupActor(
            apCtx,
            accountToFollow.apId.toString(),
        );

        if (!actor || !actorToFollow) {
            return NotFound('Remote account could not be found');
        }

        // If the account to follow is internal, we can just follow it directly
        // without federating the follow
        if (accountToFollow.isInternal) {
            await this.accountService.followAccount(
                followerAccount,
                accountToFollow,
            );
        } else {
            const followId = apCtx.getObjectUri(Follow, {
                id: uuidv4(),
            });

            const follow = new Follow({
                id: followId,
                actor: actor,
                object: actorToFollow,
            });

            const followJson = await follow.toJsonLd();

            ctx.get('globaldb').set([follow.id!.href], followJson);

            await apCtx.sendActivity(
                { username: followerAccount.username },
                actorToFollow,
                follow,
            );
        }

        return new Response(JSON.stringify(await actorToFollow.toJsonLd()), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    }

    @APIRoute('POST', 'actions/unfollow/:handle')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleUnfollow(ctx: AppContext) {
        const handle = ctx.req.param('handle');
        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });
        const unfollowerAccount = ctx.get('account');

        const actorToUnfollow = await lookupObject(apCtx, handle);

        if (!isActor(actorToUnfollow)) {
            return new Response(null, {
                status: 404,
            });
        }

        if (actorToUnfollow.id!.href === unfollowerAccount.apId.href) {
            return new Response(null, {
                status: 400,
            });
        }

        const getAccountToUnfollowResult =
            await this.accountService.ensureByApId(
                new URL(actorToUnfollow.id!.href),
            );

        if (isError(getAccountToUnfollowResult)) {
            const error = getError(getAccountToUnfollowResult);
            switch (error) {
                case 'not-found':
                    return NotFound('Remote account could not be found');
                case 'invalid-type':
                    return BadRequest('Remote account is not an Actor');
                case 'invalid-data':
                    return BadRequest('Remote account could not be parsed');
                case 'network-failure':
                    return NotFound('Remote account could not be fetched');
                default:
                    return exhaustiveCheck(error);
            }
        }

        const accountToUnfollow = getValue(getAccountToUnfollowResult);

        const isFollowing = await this.accountService.checkIfAccountIsFollowing(
            unfollowerAccount.id,
            accountToUnfollow.id,
        );

        if (!isFollowing) {
            return new Response(null, {
                status: 409,
            });
        }

        await this.accountService.unfollowAccount(
            unfollowerAccount,
            accountToUnfollow,
        );

        // If the account to unfollow is internal, we can just unfollow it directly
        // without federating the unfollow
        if (accountToUnfollow.isInternal) {
            return new Response(null, {
                status: 202,
            });
        }

        // Federate the unfollow by sending an Undo of the original follow activity
        const unfollowId = apCtx.getObjectUri(Undo, {
            id: uuidv4(),
        });

        const follow = new Follow({
            id: null,
            actor: new URL(unfollowerAccount.apId),
            object: actorToUnfollow,
        });

        const unfollow = new Undo({
            id: unfollowId,
            actor: new URL(unfollowerAccount.apId),
            object: follow,
        });

        const unfollowJson = await unfollow.toJsonLd();

        await ctx.get('globaldb').set([unfollow.id!.href], unfollowJson);

        await apCtx.sendActivity(
            { username: unfollowerAccount.username },
            actorToUnfollow,
            unfollow,
        );

        return new Response(null, {
            status: 202,
        });
    }
}
