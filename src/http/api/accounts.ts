import type { KvStore } from '@fedify/fedify';

import type { AccountService } from '../../account/account.service';
import type { AppContext } from '../../app';
import { fedify } from '../../app';
import { sanitizeHtml } from '../../helpers/html';
import { lookupActor } from '../../lookup-helpers';
import type { SiteService } from '../../site/site.service';
import type { Account as AccountDTO } from './types';

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
 * Follow account shape - Used when returning a list of follows
 */
type FollowAccount = Pick<AccountDTO, 'id' | 'name' | 'handle' | 'avatarUrl'>;

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
async function getPostCount(db: KvStore) {
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
    const following = [
        ...new Set((await db.get<string[]>(['following'])) || []),
    ];

    return following?.length || 0;
}

/**
 * Retreive the count of accounts following this account from the database
 *
 * @param db Database instance
 */
async function getFollowerCount(db: KvStore) {
    const followers = [
        ...new Set((await db.get<string[]>(['followers'])) || []),
    ];

    return followers?.length || 0;
}

/**
 * Handle a request for an account
 *
 * @param ctx App context
 */
export const handleGetAccount = (
    siteService: SiteService,
    accountService: AccountService,
) =>
    async function handleGetAccount(ctx: AppContext) {
        const logger = ctx.get('logger');

        // Validate input
        const handle = ctx.req.param('handle') || '';

        if (handle === '') {
            return new Response(null, { status: 400 });
        }

        const db = ctx.get('db');
        let accountDto: AccountDTO;

        const site = await siteService.getSiteByHost(ctx.get('site').host);
        if (!site) {
            return new Response(null, { status: 404 });
        }

        const account = await siteService.getDefaultAccountForSite(site);

        try {
            accountDto = {
                /**
                 * At the moment we don't have an internal ID for Ghost accounts so
                 * we use Fediverse ID
                 */
                id: account.ap_id,
                name: account.name || '',
                handle: getHandle(site.host, account.username),
                bio: sanitizeHtml(account.bio || ''),
                url: account.url || '',
                avatarUrl: account.avatar_url || '',
                /**
                 * At the moment we don't support banner images for Ghost accounts
                 */
                bannerImageUrl: account.banner_image_url,
                /**
                 * At the moment we don't support custom fields for Ghost accounts
                 */
                customFields: {},
                postCount: await getPostCount(db),
                likedCount: await getLikedCount(db),
                followingCount: await accountService.getFollowingCount(account),
                followerCount: await accountService.getFollowerCount(account),
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
        return new Response(JSON.stringify(accountDto), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };

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
    const follows = [...new Set((await db.get<string[]>([type])) || [])];

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

    const accounts: FollowAccount[] = [];

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
