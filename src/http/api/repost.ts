import { createHash } from 'node:crypto';

import { Announce, PUBLIC_COLLECTION } from '@fedify/fedify';
import { type AppContext, fedify } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import { parseURL } from 'core/url';
import type { PostService } from 'post/post.service';
import { BadRequest, Conflict, Forbidden, NotFound } from './helpers/response';

export function createRepostActionHandler(postService: PostService) {
    return async function repostAction(ctx: AppContext): Promise<Response> {
        const id = ctx.req.param('id');
        const apId = parseURL(id);

        if (apId === null) {
            return BadRequest('Could not parse id as URL');
        }

        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        const account = ctx.get('account');
        const postResult = await postService.repostByApId(account, apId);

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

        const announceId = apCtx.getObjectUri(Announce, {
            id: createHash('sha256').update(post.apId.href).digest('hex'),
        });

        const announce = new Announce({
            id: announceId,
            actor: account.apId,
            object: post.apId,
            to: PUBLIC_COLLECTION,
            cc: account.apFollowers,
        });

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
    };
}
