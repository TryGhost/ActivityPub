import { type Context } from 'hono';

import {
    type HonoContextVariables,
    fedify,
} from '../../app';
import { getActivityMeta, getRepliesMap } from '../../db';
import { buildActivity } from '../../helpers/activitypub/activity';

const DEFAULT_LIMIT = 10;

export async function getActivitiesAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const globaldb = ctx.get('globaldb');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {db, globaldb});

    // -------------------------------------------------------------------------
    // Process query parameters
    // -------------------------------------------------------------------------

    // Parse "cursor" and "limit" from query parameters
    // These are used to paginate the results
    // ?cursor=<string>
    // ?limit=<number>
    const queryCursor = ctx.req.query('cursor')
    const cursor = queryCursor ? Buffer.from(queryCursor, 'base64url').toString('utf-8') : null;
    const limit = Number.parseInt(ctx.req.query('limit') || DEFAULT_LIMIT.toString(), 10);

    // Parse "includeOwn" from query parameters
    // This is used to include the user's own activities in the results
    // ?includeOwn=<boolean>
    const includeOwn = ctx.req.query('includeOwn') === 'true';

    // Parse "includeReplies" from query parameters
    // This is used to include nested replies in the results
    // ?includeReplies=<boolean>
    const includeReplies = ctx.req.query('includeReplies') === 'true';

    // Parse "filter" from query parameters
    // This is used to filter the activities by various criteria
    // ?filter={type: ['<activityType>', '<activityType>:<objectType>', '<activityType>:<objectType>:<criteria>']}
    const queryFilters = ctx.req.query('filter') || '[]';
    const filters = JSON.parse(decodeURI(queryFilters))

    const typeFilters = (filters.type || []).map((filter: string) => {
        const [activityType, objectType = null, criteria = null] = filter.split(':');

        return {
            activity: activityType,
            object: objectType,
            criteria,
        }
    });

    console.log('Request query =', ctx.req.query());
    console.log('Processed query params =', JSON.stringify({
        cursor,
        limit,
        includeOwn,
        typeFilters,
    }, null, 2));

    // -------------------------------------------------------------------------
    // Fetch required data from the database
    // -------------------------------------------------------------------------

    // Fetch the liked object refs from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    // This is used to add a "liked" property to the item if the user has liked it
    const likedRefs = (await db.get<string[]>(['liked'])) || [];

    // Fetch the refs of the activities in the inbox from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    //   - First item is the oldest, last item is the newest
    const inboxRefs = ((await db.get<string[]>(['inbox'])) || [])

    // Fetch the refs of the activities in the outbox from the database (if
    // user is requesting their own activities):
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    //   - First item is the oldest, last item is the newest
    let outboxRefs: string[] = [];

    if (includeOwn) {
        outboxRefs = await db.get<string[]>(['outbox']) || [];
    }

    // To be able to return a sorted / filtered list of activities, we need to
    // fetch some additional meta data about the referenced activities. Doing this
    // upfront allows us to sort, filter and paginate the activities before
    // building them for the response which saves us from having to perform
    // unnecessary database lookups for referenced activities that will not be
    // included in the response
    let activityRefs = [...inboxRefs, ...outboxRefs];
    const activityMeta = await getActivityMeta(activityRefs);

    // If we can't find the meta data in the database for an activity, we skip
    // it as this is unexpected
    activityRefs = activityRefs.filter(ref => activityMeta.has(ref));

    // -------------------------------------------------------------------------
    // Apply filtering and sorting
    // -------------------------------------------------------------------------

    // Filter the activity refs by any provided type filters
    if (typeFilters.length > 0) {
        activityRefs = activityRefs.filter(ref => {
            const activity = activityMeta.get(ref)!;

            return typeFilters.some((filter: { activity: string; object: string | null, criteria: string | null }) => {
                // ?filter={type: ['<activityType>']}
                if (filter.activity && activity.activity_type !== filter.activity) {
                    return false;
                }

                // ?filter={type: ['<activityType>:<objectType>']}
                if (filter.object && activity.object_type !== filter.object) {
                    return false;
                }

                // ?filter={type: ['<activityType>:<objectType>:isReplyToOwn']}
                if (filter.criteria && filter.criteria.startsWith('isReplyToOwn')) {
                    // If the activity does not have a reply object url or name,
                    // we can't determine if it's a reply to an own object so
                    // we skip it
                    if (!activity.reply_object_url || !activity.reply_object_name) {
                        return false;
                    }

                    // Verify that the reply is to an object created by the user by
                    // checking that the hostname associated with the reply object
                    // is the same as the hostname of the site. This is not a bullet
                    // proof check, but it's a good enough for now (i think 😅)
                    const siteHost = ctx.get('site').host;
                    const { hostname: replyHost } = new URL(activity.reply_object_url);

                    return siteHost === replyHost;
                }

                return true;
            });
        });
    }

    // Sort the activity refs by the id of the activity (newest first).
    // We are using the id to sort because currently not all activity types have
    // a timestamp. The id property is a unique auto incremented number at the
    // database level
    activityRefs.sort((a, b) => {
        return activityMeta.get(b)!.id - activityMeta.get(a)!.id;
    });

    // -------------------------------------------------------------------------
    // Paginate
    // -------------------------------------------------------------------------

    // Find the starting index based on the cursor
    const startIndex = cursor ? activityRefs.findIndex(ref => ref === cursor) + 1 : 0;

    // Slice the results array based on the cursor and limit
    const paginatedRefs = activityRefs.slice(startIndex, startIndex + limit);

    // Determine the next cursor
    const nextCursor = startIndex + paginatedRefs.length < activityRefs.length
        ? Buffer.from(paginatedRefs[paginatedRefs.length - 1]).toString('base64url')
        : null;

    // -------------------------------------------------------------------------
    // Build the activities and return the response
    // -------------------------------------------------------------------------

    const activities = [];

    // If we need to include replies, fetch the replies map based on the paginated
    // activity refs, which will be utilised when building the activities
    const repliesMap = includeReplies
        ? await getRepliesMap(paginatedRefs)
        : null;

    // Build the activities
    for (const ref of paginatedRefs) {
        try {
            const builtActivity = await buildActivity(ref, globaldb, apCtx, likedRefs, repliesMap, true);

            if (builtActivity) {
                activities.push(builtActivity);
            }
        } catch (err) {
            console.log(err);
        }
    }

    // Return the response
    return new Response(JSON.stringify({
        items: activities,
        nextCursor,
    }), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
