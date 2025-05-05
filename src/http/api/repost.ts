import { createHash } from 'node:crypto';

import { type Actor, Announce, PUBLIC_COLLECTION } from '@fedify/fedify';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import { type AppContext, fedify } from 'app';
import { getValue, isError } from 'core/result';
import { addToList } from 'kv-helpers';
import { lookupActor, lookupObject } from 'lookup-helpers';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';

export function createRepostActionHandler(
    accountRepository: KnexAccountRepository,
    postService: PostService,
    postRepository: KnexPostRepository,
) {
    return async function repostAction(ctx: AppContext) {
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
