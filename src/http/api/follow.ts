import { Follow, Undo, isActor } from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { AccountService } from 'account/account.service';
import { mapActorToExternalAccountData } from 'account/utils';
import type { AppContext } from 'app';
import { fedify } from 'app';
import { lookupObject } from 'lookup-helpers';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';

export class FollowController {
    constructor(private readonly accountService: AccountService) {}

    async handleFollow(ctx: AppContext) {
        const handle = ctx.req.param('handle');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });
        const actorToFollow = await lookupObject(apCtx, handle);

        if (!isActor(actorToFollow)) {
            return new Response(null, {
                status: 404,
            });
        }

        const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE); // TODO This should be the actor making the request

        if (actorToFollow.id!.href === actor!.id!.href) {
            return new Response(null, {
                status: 400,
            });
        }

        const followerAccount = await this.accountService.getAccountByApId(
            actor!.id!.href,
        );

        if (!followerAccount) {
            return new Response(null, {
                status: 404,
            });
        }

        let followeeAccount = await this.accountService.getAccountByApId(
            actorToFollow.id!.href,
        );
        if (!followeeAccount) {
            followeeAccount = await this.accountService.createExternalAccount(
                await mapActorToExternalAccountData(actorToFollow),
            );
        }

        if (
            await this.accountService.checkIfAccountIsFollowing(
                followerAccount.id,
                followeeAccount.id,
            )
        ) {
            return new Response(null, {
                status: 409,
            });
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
            { handle: ACTOR_DEFAULT_HANDLE },
            actorToFollow,
            follow,
        );

        // We return the actor because the serialisation of the object property is not working as expected
        return new Response(JSON.stringify(await actorToFollow.toJsonLd()), {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        });
    }

    async handleUnfollow(ctx: AppContext) {
        const handle = ctx.req.param('handle');
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db: ctx.get('db'),
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
            { handle: ACTOR_DEFAULT_HANDLE },
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
