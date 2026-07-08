import type { AppContext } from '@/app';
import { requireParam } from '@/http/api/helpers/request';
import { NotFound } from '@/http/api/helpers/response';
import type { GhostPostView } from '@/http/api/views/ghost-post.view';
import { Route } from '@/http/decorators/route.decorator';

/**
 * Controller for resolving Ghost posts to their ActivityPub objects
 */
export class GhostPostController {
    constructor(private readonly ghostPostView: GhostPostView) {}

    /**
     * Handle a request to resolve a Ghost post, by its UUID, to the
     * ActivityPub object that was created from it
     *
     * The UUID is the only identifier Ghost can derive for a post without
     * knowledge of this service's data, so this URL is what Ghost (or anything
     * else that knows the post's UUID) can advertise for ActivityPub
     * discovery, e.g. via a <link rel="alternate"> tag on the post's page
     *
     * @see https://swicg.github.io/activitypub-html-discovery/
     */
    @Route('GET', '/.ghost/activitypub/ghost-post/:uuid')
    async handleGetByGhostUuid(ctx: AppContext) {
        const ghostUuid = requireParam(ctx, 'uuid');
        const account = ctx.get('account');

        const apId = await this.ghostPostView.getApIdByGhostUuid(
            ghostUuid,
            account.id,
        );

        if (apId === null) {
            return NotFound('Post not found');
        }

        return ctx.redirect(apId, 302);
    }
}
