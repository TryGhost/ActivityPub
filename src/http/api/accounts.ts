import type { KvStore } from '@fedify/fedify';

import type { AppContext } from '../../app';
import { fedify } from '../../app';
import { sanitizeHtml } from '../../helpers/html';
import { lookupActor } from '../../lookup-helpers';

/**
 * Maximum number of follows to return
 */
const FOLLOWS_LIMIT = 20;

/**
 * Account data stored in the database - This should correspond to the shape
 * of the data when retrieved from the Fediverse
 */
interface DbAccountData {
    id: string;
    name: string;
    summary: string;
    preferredUsername: string;
    icon: string;
    inbox: string;
    outbox: string;
    following: string;
    followers: string;
    liked: string;
    url: string;
}

/**
 * Account returned by the API - Anywhere an account is returned via the API,
 * it should be this shape, or a partial version of it
 */
interface Account {
    /**
     * Internal ID of the account
     */
    id: string;
    /**
     * Display name of the account
     */
    name: string;
    /**
     * Handle of the account
     */
    handle: string;
    /**
     * Bio of the account
     */
    bio: string;
    /**
     * Public URL of the account
     */
    url: string;
    /**
     * URL pointing to the avatar of the account
     */
    avatarUrl: string;
    /**
     * URL pointing to the banner image of the account
     */
    bannerImageUrl: string | null;
    /**
     * Custom fields of the account
     */
    customFields: Record<string, string>;
    /**
     * Number of posts created by the account
     */
    postsCount: number;
    /**
     * Number of liked posts by the account
     */
    likedCount: number;
    /**
     * Number of accounts this account follows
     */
    followingCount: number;
    /**
     * Number of accounts following this account
     */
    followerCount: number;
    /**
     * Whether the account of the current user is followed by this account
     */
    followsMe: boolean;
    /**
     * Whether the account of the current user is following this account
     */
    followedByMe: boolean;
}

/**
 * Minimal account shape - Used when returning a list of follows
 */
type MinimalAccount = Pick<Account, 'id' | 'name' | 'handle' | 'avatarUrl'>;

/**
 * Compute the handle for an account from the provided host and username
 *
 * @param host Host of the account
 * @param username Username of the account
 */
function getHandle(host?: string, username?: string) {
    return `@${username || 'unknown'}@${host || 'unknown'}`;
}

/**
 * Retreive the count of posts created by the account from the database
 *
 * @param db Database instance
 */
async function getPostsCount(db: KvStore) {
    const posts = await db.get<string[]>(['outbox']);

    return posts?.length || 0;
}

/**
 * Retreive the count of posts liked by the account from the database
 *
 * @param db Database instance
 */
async function getLikedCount(db: KvStore) {
    const liked = await db.get<string[]>(['liked']);

    return liked?.length || 0;
}

/**
 * Retreive the count of accounts this account follows from the database
 *
 * @param db Database instance
 */
async function getFollowingCount(db: KvStore) {
    const following = await db.get<string[]>(['following']);

    return following?.length || 0;
}

/**
 * Retreive the count of accounts following this account from the database
 *
 * @param db Database instance
 */
async function getFollowerCount(db: KvStore) {
    const followers = await db.get<string[]>(['followers']);

    return followers?.length || 0;
}

/**
 * Handle a request for an account
 *
 * @param ctx App context
 */
export async function handleGetAccount(ctx: AppContext) {
    const logger = ctx.get('logger');

    // Validate input
    const handle = ctx.req.param('handle') || '';

    if (handle === '') {
        return new Response(null, { status: 400 });
    }

    // Get account data
    const db = ctx.get('db');
    const accountData = await db.get<DbAccountData>(['handle', handle]);

    if (!accountData) {
        return new Response(null, { status: 404 });
    }

    let account: Account;

    try {
        account = {
            /**
             * At the moment we don't have an internal ID for Ghost accounts so
             * we use Fediverse ID
             */
            id: accountData.id,
            name: accountData.name,
            handle: getHandle(
                new URL(accountData.id).host,
                accountData.preferredUsername,
            ),
            bio: sanitizeHtml(accountData.summary),
            url: accountData.id,
            avatarUrl: accountData.icon,
            /**
             * At the moment we don't support banner images for Ghost accounts
             */
            bannerImageUrl: null,
            /**
             * At the moment we don't support custom fields for Ghost accounts
             */
            customFields: {},
            postsCount: await getPostsCount(db),
            likedCount: await getLikedCount(db),
            followingCount: await getFollowingCount(db),
            followerCount: await getFollowerCount(db),
            /**
             * At the moment we only expect to be returning the account for
             * the current user, so we can hardcode these values to false as
             * the account cannot follow, or be followed by itself
             */
            followsMe: false,
            followedByMe: false,
        };
    } catch (error) {
        logger.error('Error getting account: {error}', { error });

        return new Response(null, { status: 500 });
    }

    // Return response
    return new Response(JSON.stringify(account), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}

/**
 * Handle a request for a list of follows
 *
 * @param ctx App context
 */
export async function handleGetAccountFollows(ctx: AppContext) {
    const logger = ctx.get('logger');

    // Validate input
    const handle = ctx.req.param('handle') || '';

    if (handle === '') {
        return new Response(null, { status: 400 });
    }

    const type = ctx.req.param('type');

    if (!['following', 'followers'].includes(type)) {
        return new Response(null, { status: 400 });
    }

    // Get follows and paginate
    const queryNext = ctx.req.query('next') || '0';
    const offset = Number.parseInt(queryNext);

    const db = ctx.get('db');
    const follows = (await db.get<string[]>([type])) || [];

    const next =
        follows.length > offset + FOLLOWS_LIMIT
            ? (offset + FOLLOWS_LIMIT).toString()
            : null;

    const slicedFollows = follows.slice(offset, offset + FOLLOWS_LIMIT);

    // Get required data for each follow account
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb: ctx.get('globaldb'),
        logger: ctx.get('logger'),
    });

    const accounts: MinimalAccount[] = [];

    for (const followId of slicedFollows) {
        try {
            const accountData = await lookupActor(apCtx, followId);

            if (accountData) {
                const id = accountData.id;

                if (!id) {
                    continue;
                }

                accounts.push({
                    /**
                     * At the moment we don't have an internal ID for accounts
                     * so we use Fediverse ID
                     */
                    id: id.href,
                    name: accountData.name?.toString() || 'unknown',
                    handle: getHandle(
                        id.host,
                        accountData.preferredUsername?.toString(),
                    ),
                    avatarUrl:
                        (await accountData.getIcon())?.url?.href?.toString() ||
                        '',
                });
            }
        } catch (error) {
            logger.error('Error getting account: {error}', { error });
        }
    }

    // Return response
    return new Response(
        JSON.stringify({
            accounts,
            total: follows.length,
            next,
        }),
        {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        },
    );
}
