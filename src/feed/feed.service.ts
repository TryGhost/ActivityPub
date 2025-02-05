import type { KvStore } from '@fedify/fedify';

import type { FedifyRequestContext } from '../app';
import {
    ACTIVITY_OBJECT_TYPE_ARTICLE,
    ACTIVITY_OBJECT_TYPE_NOTE,
} from '../constants';
import { getActivityMeta } from '../db';
import { type Activity, buildActivity } from '../helpers/activitypub/activity';
import { spanWrapper } from '../instrumentation';
import { PostType } from './types';

export interface GetFeedOptions {
    postType: PostType | null;
    limit: number;
    cursor: string | null;
}

export interface GetFeedResult {
    items: Activity[];
    nextCursor: string | null;
}

export class FeedService {
    /**
     * Get a user's feed using the KV store
     *
     * The feed should contain posts that:
     * - Have been authored by the user (i.e Create(Article), Create(Note) in the user's outbox)
     * - Have been reposted by the user (i.e Announce(Article), Announce(Note) in the user's outbox)
     * - Have been authored by an account that the user follows (i.e Create(Article), Create(Note) in the user's inbox)
     * - Have been reposted by an account that the user follows (i.e Announce(Article), Announce(Note) in the user's inbox)
     * - Are not replies to other posts (i.e Create(Note).inReplyTo)
     *
     * The feed should be ordered reverse chronologically
     *
     * This method can be deprecated once we are reading data from the dedicated `posts` table
     *
     * @param db User scoped KV store
     * @param fedifyCtx Fedify request context
     * @param options Options for the query
     */
    async getFeedFromKvStore(
        db: KvStore,
        fedifyCtx: FedifyRequestContext,
        options: GetFeedOptions,
    ): Promise<GetFeedResult> {
        // Used to look up if a post is liked by the user
        const likedRefs = (await db.get<string[]>(['liked'])) || [];

        // Used to look up if a post is reposted by the user
        const repostedRefs = (await db.get<string[]>(['reposted'])) || [];

        // Used to look up posts from followers
        const inboxRefs = (await db.get<string[]>(['inbox'])) || [];

        // Used to look up the users own posts
        const outboxRefs = (await db.get<string[]>(['outbox'])) || [];

        let activityRefs = [...inboxRefs, ...outboxRefs];

        // Filter the activityRefs by the provided post type
        const activityMeta = await getActivityMeta(activityRefs);
        activityRefs = activityRefs
            // If we can't find the meta data in the database for an activity, we
            // skip it as this is unexpected
            .filter((ref) => activityMeta.has(ref))
            // Filter the activityRefs by the provided post type if provided. If
            // no post type is provided, we include all articles and notes
            .filter((ref) => {
                const meta = activityMeta.get(ref);

                if (options.postType === null) {
                    return [
                        ACTIVITY_OBJECT_TYPE_ARTICLE,
                        ACTIVITY_OBJECT_TYPE_NOTE,
                    ].includes(meta!.object_type);
                }

                if (options.postType === PostType.Article) {
                    return meta!.object_type === ACTIVITY_OBJECT_TYPE_ARTICLE;
                }

                if (options.postType === PostType.Note) {
                    return meta!.object_type === ACTIVITY_OBJECT_TYPE_NOTE;
                }
            });

        // Sort the activity refs by the latest first (yes using the ID which
        // is totally gross but we have no other option at the moment)
        activityRefs.sort((a, b) => {
            return activityMeta.get(b)!.id - activityMeta.get(a)!.id;
        });

        // Paginate the activity refs
        const startIndex = options.cursor
            ? activityRefs.findIndex((ref) => ref === options.cursor) + 1
            : 0;

        const paginatedRefs = activityRefs.slice(
            startIndex,
            startIndex + options.limit,
        );

        const nextCursor =
            startIndex + paginatedRefs.length < activityRefs.length
                ? encodeURIComponent(paginatedRefs[paginatedRefs.length - 1])
                : null;

        // Build the activities
        const activities = await Promise.all(
            paginatedRefs.map(async (ref) => {
                try {
                    return await spanWrapper(buildActivity)(
                        ref,
                        fedifyCtx.data.globaldb,
                        fedifyCtx,
                        likedRefs,
                        repostedRefs,
                        true,
                    );
                } catch (err) {
                    fedifyCtx.data.logger.error(
                        'Error building activity ({ref}): {error}',
                        {
                            ref,
                            error: err,
                        },
                    );

                    return null;
                }
            }),
        );

        return {
            items: activities.filter((activity) => activity !== null),
            nextCursor,
        };
    }
}
