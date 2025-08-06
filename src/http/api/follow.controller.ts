import { type Federation, Follow, isActor, Undo } from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { AccountService } from '@/account/account.service';
import { mapActorToExternalAccountData } from '@/account/utils';
import type { AppContext, ContextData } from '@/app';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import {
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
} from '@/http/api/helpers/response';
import { RequireRoles, Route } from '@/http/decorators/route.decorator';
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

    @Route('POST', '/.ghost/activitypub/v1/actions/follow/:handle')
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

        // Federate the follow
        const actor = await lookupActor(apCtx, followerAccount.apId.toString());
        const actorToFollow = await lookupActor(
            apCtx,
            accountToFollow.apId.toString(),
        );

        if (!actor || !actorToFollow) {
            return NotFound('Remote account could not be found');
        }

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

        return new Response(JSON.stringify(await actorToFollow.toJsonLd()), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    }

    @Route('POST', '/.ghost/activitypub/v1/actions/unfollow/:handle')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleUnfollow(ctx: AppContext) {
        const handle = ctx.req.param('handle');
        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const actorToUnfollow = await lookupObject(apCtx, handle);

        if (!isActor(actorToUnfollow)) {
            return new Response(null, {
                status: 404,
            });
        }

        const account = await this.accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );

        if (actorToUnfollow.id!.href === account.ap_id) {
            return new Response(null, {
                status: 400,
            });
        }

        let accountToUnfollow = await this.accountService.getAccountByApId(
            actorToUnfollow.id!.href,
        );

        // TODO I think we can exit early here - there is obviously no follow relation if there is no account
        if (!accountToUnfollow) {
            accountToUnfollow = await this.accountService.createExternalAccount(
                await mapActorToExternalAccountData(actorToUnfollow),
            );
        }

        const isFollowing = await this.accountService.checkIfAccountIsFollowing(
            account.id,
            accountToUnfollow.id,
        );

        if (!isFollowing) {
            return new Response(null, {
                status: 409,
            });
        }

        // Need to get the follow
        const unfollowId = apCtx.getObjectUri(Undo, {
            id: uuidv4(),
        });

        const follow = new Follow({
            id: null,
            actor: new URL(account.ap_id),
            object: actorToUnfollow,
        });

        const unfollow = new Undo({
            id: unfollowId,
            actor: new URL(account.ap_id),
            object: follow,
        });

        const unfollowJson = await unfollow.toJsonLd();

        await ctx.get('globaldb').set([unfollow.id!.href], unfollowJson);

        await apCtx.sendActivity(
            { username: account.username },
            actorToUnfollow,
            unfollow,
        );

        await this.accountService.recordAccountUnfollow(
            accountToUnfollow,
            account,
        );

        return new Response(JSON.stringify(unfollowJson), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 202,
        });
    }
}
