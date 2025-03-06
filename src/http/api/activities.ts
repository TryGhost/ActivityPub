import { type AppContext, fedify } from '../../app';
import { getActivityMeta } from '../../db';
import { buildActivity } from '../../helpers/activitypub/activity';
import { spanWrapper } from '../../instrumentation';

const GET_ACTIVITIES_DEFAULT_LIMIT = 10;

/**
 * Handle a request for activities
 *
 * @param ctx App context instance
 */
export async function handleGetActivities(ctx: AppContext) {
    const db = ctx.get('db');
    const globaldb = ctx.get('globaldb');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb,
        logger,
    });

    // -------------------------------------------------------------------------
    // Process query parameters
    // -------------------------------------------------------------------------

    // Parse "cursor" and "limit" from query parameters
    // These are used to paginate the results
    // ?cursor=<string>
    // ?limit=<number>
    const queryCursor = ctx.req.query('cursor');
    const cursor = queryCursor ? decodeURIComponent(queryCursor) : null;
    const limit = Number.parseInt(
        ctx.req.query('limit') || GET_ACTIVITIES_DEFAULT_LIMIT.toString(),
        10,
    );

    // Parse "includeOwn" from query parameters
    // This is used to include the user's own activities in the results
    // ?includeOwn=<boolean>
    const includeOwn = ctx.req.query('includeOwn') === 'true';

    // Parse "filter" from query parameters
    // This is used to filter the activities by various criteria
    // ?filter={type: ['<activityType>', '<activityType>:<objectType>']}
    const queryFilters = ctx.req.query('filter') || '[]';
    const filters = JSON.parse(decodeURIComponent(queryFilters));

    const typeFilters = (filters.type || []).map((filter: string) => {
        const [activityType, objectType = null, criteria = null] =
            filter.split(':');

        return {
            activity: activityType,
            object: objectType,
            criteria,
        };
    });

    logger.info('Request query = {query}', { query: ctx.req.query() });
    logger.info('Processed query params = {params}', {
        params: JSON.stringify({
            cursor,
            limit,
            includeOwn,
            typeFilters,
        }),
    });

    // -------------------------------------------------------------------------
    // Fetch required data from the database
    // -------------------------------------------------------------------------

    // Fetch the refs of the activities in the inbox from the database:
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    //   - First item is the oldest, last item is the newest
    const inboxRefs = (await db.get<string[]>(['inbox'])) || [];

    // Fetch the refs of the activities in the outbox from the database (if
    // user is requesting their own activities):
    //   - Data is structured as an array of strings
    //   - Each string is a URI to an object in the database
    //   - First item is the oldest, last item is the newest
    let outboxRefs: string[] = [];

    if (includeOwn) {
        outboxRefs = (await db.get<string[]>(['outbox'])) || [];
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
    activityRefs = activityRefs.filter((ref) => activityMeta.has(ref));

    // -------------------------------------------------------------------------
    // Apply filtering and sorting
    // -------------------------------------------------------------------------

    // Filter the activity refs by any provided type filters
    if (typeFilters.length > 0) {
        activityRefs = activityRefs.filter((ref) => {
            const meta = activityMeta.get(ref)!;

            return typeFilters.some(
                (filter: {
                    activity: string;
                    object: string | null;
                    criteria: string | null;
                }) => {
                    // ?filter={type: ['<activityType>']}
                    if (
                        filter.activity &&
                        meta.activity_type !== filter.activity
                    ) {
                        return false;
                    }

                    // ?filter={type: ['<activityType>:<objectType>']}
                    if (filter.object && meta.object_type !== filter.object) {
                        return false;
                    }

                    return true;
                },
            );
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

    const startIndex = cursor
        ? activityRefs.findIndex((ref) => ref === cursor) + 1
        : 0;

    const paginatedRefs = activityRefs.slice(startIndex, startIndex + limit);

    const nextCursor =
        startIndex + paginatedRefs.length < activityRefs.length
            ? encodeURIComponent(paginatedRefs[paginatedRefs.length - 1])
            : null;

    // -------------------------------------------------------------------------
    // Build the activities and return the response
    // -------------------------------------------------------------------------

    const activities = await Promise.all(
        paginatedRefs.map(async (ref) => {
            const wrappedBuildActivity = spanWrapper(buildActivity);

            try {
                return await wrappedBuildActivity(
                    ref,
                    globaldb,
                    apCtx,
                    [],
                    [],
                    outboxRefs,
                    {
                        expandInReplyTo: true,
                        showReplyCount: true,
                        showRepostCount: true,
                    },
                );
            } catch (err) {
                logger.error('Error building activity ({ref}): {error}', {
                    ref,
                    error: err,
                });
                return null;
            }
        }),
    ).then((results) => results.filter(Boolean));

    return new Response(
        JSON.stringify({
            items: activities,
            next: nextCursor,
        }),
        {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        },
    );
}
