import {
    Activity,
    CollectionPage,
    isActor,
    lookupObject,
} from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { type Result, error, getValue, isError, ok } from 'core/result';
import { sanitizeHtml } from 'helpers/html';
import type { Knex } from 'knex';
import { ContentPreparer } from 'post/content';
import { type Mention, OutboxType, PostType } from 'post/post.entity';
import type { PostDTO } from '../types';

export type GetPostsError =
    | 'invalid-next-parameter'
    | 'error-getting-outbox'
    | 'no-page-found'
    | 'not-an-actor';

export type GetPostsFromOutboxError = 'not-internal-account';

interface BaseGetProfileDataResultRow {
    post_id: number;
    post_type: PostType;
    post_title: string | null;
    post_excerpt: string | null;
    post_summary: string | null;
    post_content: string | null;
    post_url: string;
    post_image_url: string | null;
    post_published_at: Date;
    post_like_count: number;
    post_liked_by_current_user: 0 | 1;
    post_reply_count: number;
    post_reading_time_minutes: number;
    post_repost_count: number;
    post_reposted_by_current_user: 0 | 1;
    post_ap_id: string;
    post_attachments: {
        type: string | null;
        mediaType: string | null;
        name: string | null;
        url: string;
    }[];
    author_id: number;
    author_name: string | null;
    author_username: string;
    author_url: string | null;
    author_avatar_url: string | null;
    author_followed_by_current_user: 0 | 1;
}

interface GetProfileDataResultRowReposted extends BaseGetProfileDataResultRow {
    reposter_id: number;
    reposter_name: string | null;
    reposter_username: string;
    reposter_url: string | null;
    reposter_avatar_url: string | null;
    reposter_followed_by_current_user: 0 | 1;
}

interface GetProfileDataResultRowWithoutReposted
    extends BaseGetProfileDataResultRow {
    reposter_id: null;
    reposter_name: null;
    reposter_username: null;
    reposter_url: null;
    reposter_avatar_url: null;
    reposter_followed_by_current_user: 0;
}

export type GetProfileDataResultRow =
    | GetProfileDataResultRowReposted
    | GetProfileDataResultRowWithoutReposted;

export interface AccountPosts {
    results: PostDTO[];
    nextCursor: string | null;
}

type AccountFetchError = 'not-an-actor' | 'network-failure' | 'not-found';

export class AccountPostsView {
    constructor(
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async getPostsByApId(
        apId: URL,
        account: Account | null,
        currentContextAccount: Account,
        limit: number,
        cursor: string | null,
    ): Promise<Result<AccountPosts, GetPostsError>> {
        //If we found the account in our db and it's an internal account, do an internal lookup
        if (account?.isInternal) {
            const result = await this.getPostsFromOutbox(
                account,
                currentContextAccount.id,
                limit,
                cursor,
            );
            if (isError(result)) {
                throw new Error(
                    'Account was not internal, after checking account was internal',
                );
            }

            return result;
        }

        //Otherwise, do a remote lookup to fetch the posts
        return this.getPostsByRemoteLookUp(
            currentContextAccount.id,
            currentContextAccount.apId,
            apId,
            cursor,
            account,
        );
    }

    async getPostsFromOutbox(
        account: Account,
        contextAccountId: number,
        limit: number,
        cursor: string | null,
    ): Promise<Result<AccountPosts, GetPostsFromOutboxError>> {
        if (!account.isInternal) {
            return error('not-internal-account');
        }

        const query = this.db('outboxes')
            .select(
                // Post fields
                'posts.id as post_id',
                'posts.type as post_type',
                'posts.title as post_title',
                'posts.excerpt as post_excerpt',
                'posts.summary as post_summary',
                'posts.content as post_content',
                'posts.url as post_url',
                'posts.image_url as post_image_url',
                'posts.published_at as post_published_at',
                'posts.like_count as post_like_count',
                this.db.raw(`
                    CASE
                        WHEN likes.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_liked_by_current_user
                `),
                'posts.reply_count as post_reply_count',
                'posts.reading_time_minutes as post_reading_time_minutes',
                'posts.attachments as post_attachments',
                'posts.repost_count as post_repost_count',
                this.db.raw(`
                    CASE
                        WHEN reposts.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_reposted_by_current_user
                `),
                'posts.ap_id as post_ap_id',
                // Author fields
                'author_account.id as author_id',
                'author_account.name as author_name',
                'author_account.username as author_username',
                'author_account.url as author_url',
                'author_account.avatar_url as author_avatar_url',
                this.db.raw(`
                    CASE
                        WHEN follows_author.following_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS author_followed_by_current_user
                `),
                // Reposter fields
                'reposter_account.id as reposter_id',
                'reposter_account.name as reposter_name',
                'reposter_account.username as reposter_username',
                'reposter_account.url as reposter_url',
                'reposter_account.avatar_url as reposter_avatar_url',
                this.db.raw(`
                    CASE
                        WHEN follows_reposter.following_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS reposter_followed_by_current_user
                `),
                // Outbox fields
                'outboxes.published_at as outbox_published_at',
                'outboxes.outbox_type as outbox_type',
            )
            .innerJoin('posts', 'posts.id', 'outboxes.post_id')
            .innerJoin(
                'accounts as author_account',
                'author_account.id',
                'posts.author_id',
            )
            .leftJoin('accounts as reposter_account', function () {
                this.on(
                    'reposter_account.id',
                    '=',
                    'outboxes.account_id',
                ).andOnVal(
                    'outboxes.outbox_type',
                    '=',
                    OutboxType.Repost.toString(),
                );
            })
            .leftJoin('follows as follows_author', function () {
                this.on(
                    'follows_author.following_id',
                    'author_account.id',
                ).andOnVal(
                    'follows_author.follower_id',
                    '=',
                    contextAccountId.toString(),
                );
            })
            .leftJoin('follows as follows_reposter', function () {
                this.on(
                    'follows_reposter.following_id',
                    'reposter_account.id',
                ).andOnVal(
                    'follows_reposter.follower_id',
                    '=',
                    contextAccountId.toString(),
                );
            })
            .leftJoin('likes', function () {
                this.on('likes.post_id', 'posts.id').andOnVal(
                    'likes.account_id',
                    '=',
                    contextAccountId.toString(),
                );
            })
            .leftJoin('reposts', function () {
                this.on('reposts.post_id', 'posts.id').andOnVal(
                    'reposts.account_id',
                    '=',
                    contextAccountId.toString(),
                );
            })
            .where('outboxes.account_id', account.id)
            .whereNot('outboxes.outbox_type', OutboxType.Reply)
            .modify((query) => {
                if (cursor) {
                    query.where('outboxes.published_at', '<', cursor);
                }
            })
            .orderBy('outboxes.published_at', 'desc')
            .limit(limit + 1);

        const results = await query;

        const hasMore = results.length > limit;
        const paginatedResults = results.slice(0, limit);
        const lastResult = paginatedResults[paginatedResults.length - 1];

        return ok({
            results: paginatedResults.map((result: GetProfileDataResultRow) =>
                this.mapToPostDTO(result, contextAccountId),
            ),
            nextCursor:
                hasMore && lastResult ? lastResult.outbox_published_at : null,
        });
    }

    async getPostsByRemoteLookUp(
        currentContextAccountId: number,
        currentContextAccountApId: URL,
        apId: URL,
        cursor: string | null,
        account?: Account | null,
    ): Promise<Result<AccountPosts, GetPostsError>> {
        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });

        // Lookup actor by handle
        const actor = await lookupObject(apId, { documentLoader });

        if (!isActor(actor)) {
            return error('not-an-actor');
        }

        // Retrieve actor's posts
        // If a next parameter was provided, use it to retrieve a specific page of
        // posts. Otherwise, retrieve the first page of posts
        const result: AccountPosts = {
            results: [],
            nextCursor: null,
        };

        let page: CollectionPage | null = null;

        // Check if current user follows the account whose posts we're viewing
        const currentUserFollowsProfileAccount = account
            ? !!(await this.db('follows')
                  .where({
                      follower_id: currentContextAccountId,
                      following_id: account.id,
                  })
                  .first())
            : false;

        try {
            if (cursor) {
                // Ensure the next parameter is for the same host as the actor. We
                // do this to prevent blindly passing URIs to lookupObject (i.e next
                // param has been tampered with)
                const nextUrl = new URL(cursor);
                const { host: actorHost } = actor?.id || new URL('');
                const { host: nextHost } = nextUrl;

                if (actorHost !== nextHost) {
                    return error('invalid-next-parameter');
                }

                page = (await lookupObject(nextUrl, {
                    documentLoader,
                })) as CollectionPage | null;

                // Check that we have a valid page
                if (!(page instanceof CollectionPage) || !page?.itemIds) {
                    page = null;
                }
            } else {
                const outbox = await actor.getOutbox();

                if (outbox) {
                    page = await outbox.getFirst();
                }
            }
        } catch (err) {
            return error('error-getting-outbox');
        }

        if (!page) {
            return error('no-page-found');
        }

        // Return result
        for await (const item of page.getItems()) {
            try {
                if (!(item instanceof Activity)) {
                    continue;
                }

                const object = await item.getObject();
                if (!object) {
                    continue;
                }
                const attributedTo = await object.getAttribution();
                if (!attributedTo) {
                    continue;
                }

                const activityObject = (await item.toJsonLd({
                    format: 'compact',
                })) as unknown;

                if (
                    typeof activityObject !== 'object' ||
                    activityObject === null
                ) {
                    continue;
                }

                const activity = activityObject as {
                    type: string;
                    object: {
                        id: string;
                        type: string;
                        name?: string;
                        preview?: { content?: string };
                        summary?: string;
                        content?: string;
                        url?: string;
                        image?: string | null;
                        published?: string;
                        liked?: boolean;
                        replyCount?: number;
                        attachment?: Array<{
                            type?: string;
                            mediaType?: string;
                            name?: string;
                            url: string;
                        }>;
                        attributedTo: {
                            id: string;
                            preferredUsername: string;
                            name?: string;
                            icon?: { url?: string };
                            followedByMe?: boolean;
                        };
                        authored?: boolean;
                        repostCount?: number;
                        reposted?: boolean;
                        inReplyTo?: unknown;
                        tag?: Array<{
                            type: string;
                            name: string;
                            href: string;
                        }>;
                    };
                    actor: {
                        id: string;
                        preferredUsername: string;
                        name?: string;
                        icon?: { url?: string };
                        followedByMe?: boolean;
                    };
                };

                if (activity.object.inReplyTo) {
                    continue;
                }

                if (activity?.object?.content) {
                    activity.object.content = sanitizeHtml(
                        activity.object.content,
                    );
                }

                activity.object.authored =
                    currentContextAccountApId.toString() === activity.actor.id;

                // Add counters & flags to the object
                activity.object.replyCount = 0;
                activity.object.repostCount = 0;
                activity.object.liked = false;
                activity.object.reposted = false;

                if (object?.id) {
                    const post = await this.getByApId(object.id);

                    activity.object.replyCount = post ? post.reply_count : 0;
                    activity.object.repostCount = post ? post.repost_count : 0;

                    activity.object.liked = post
                        ? await this.isLikedByAccount(
                              post.id!,
                              currentContextAccountId,
                          )
                        : false;

                    activity.object.reposted = post
                        ? await this.isRepostedByAccount(
                              post.id!,
                              currentContextAccountId,
                          )
                        : false;
                }

                if (typeof activity.actor === 'string') {
                    const actorJson = await actor.toJsonLd({
                        format: 'compact',
                    });
                    if (typeof actorJson === 'object' && actorJson !== null) {
                        activity.actor = actorJson as typeof activity.actor;
                    }
                }

                if (typeof activity.object.attributedTo === 'string') {
                    const attributedTo = await lookupObject(
                        activity.object.attributedTo,
                        { documentLoader },
                    );
                    activity.object.attributedTo = {
                        id: activity.object.attributedTo,
                        preferredUsername: '',
                    };
                    if (isActor(attributedTo)) {
                        const attributedToJson = await attributedTo.toJsonLd({
                            format: 'compact',
                        });
                        if (
                            typeof attributedToJson === 'object' &&
                            attributedToJson !== null
                        ) {
                            activity.object.attributedTo =
                                attributedToJson as typeof activity.object.attributedTo;
                        }
                    } else if (activity.type === 'Announce') {
                        // If the attributedTo is not an actor, it is a repost and we don't want to show it
                        continue;
                    }
                }

                // Check if current user follows the post author
                let authorFollowedByMe = currentUserFollowsProfileAccount;

                if (activity.type !== 'Announce') {
                    const authorAccount = await this.getAccountByApId(
                        new URL(activity.object.attributedTo.id),
                    );

                    if (authorAccount) {
                        const followsAuthor = await this.db('follows')
                            .where({
                                follower_id: currentContextAccountId,
                                following_id: authorAccount.id,
                            })
                            .first();

                        authorFollowedByMe = !!followsAuthor;
                    } else {
                        authorFollowedByMe = false;
                    }
                }

                activity.object.attributedTo.followedByMe = authorFollowedByMe;

                if (activity.object.tag && activity.object.type === 'Note') {
                    const mentionedAccounts: Mention[] = [];
                    const tags = Array.isArray(activity.object.tag)
                        ? activity.object.tag
                        : [activity.object.tag];

                    const mentions = tags.filter(
                        (tag) => tag.type === 'Mention',
                    );

                    for (const mention of mentions) {
                        const account = await this.getMentionedAccount(
                            new URL(mention.href),
                            mention.name,
                        );

                        if (!isError(account)) {
                            mentionedAccounts.push(getValue(account));
                        }
                    }
                    activity.object.content = ContentPreparer.updateMentions(
                        activity.object.content ?? '',
                        mentionedAccounts,
                    );
                }

                result.results.push(this.mapActivityToPostDTO(activity));
            } catch (err) {
                // If we can't map a post to an activity, skip it
                // This ensures that a single invalid or unreachable post doesn't block the API from returning valid posts
            }
        }

        result.nextCursor = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return ok(result);
    }

    async getPostsLikedByAccount(
        accountId: number,
        limit: number,
        cursor: string | null,
    ): Promise<AccountPosts> {
        const query = this.db('likes')
            .select(
                'likes.id as likes_id',
                // Post fields
                'posts.id as post_id',
                'posts.type as post_type',
                'posts.title as post_title',
                'posts.excerpt as post_excerpt',
                'posts.summary as post_summary',
                'posts.content as post_content',
                'posts.url as post_url',
                'posts.image_url as post_image_url',
                'posts.published_at as post_published_at',
                'posts.like_count as post_like_count',
                this.db.raw('1 AS post_liked_by_current_user'), // Since we are selecting from `likes`, this is always 1
                'posts.reply_count as post_reply_count',
                'posts.reading_time_minutes as post_reading_time_minutes',
                'posts.attachments as post_attachments',
                'posts.repost_count as post_repost_count',
                this.db.raw(
                    `CASE
                        WHEN reposts.post_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_reposted_by_current_user`,
                ),
                'posts.ap_id as post_ap_id',
                // Author fields
                'author_account.id as author_id',
                'author_account.name as author_name',
                'author_account.username as author_username',
                'author_account.url as author_url',
                'author_account.avatar_url as author_avatar_url',
                this.db.raw(`
                    CASE
                        WHEN follows_author.following_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS author_followed_by_current_user
                `),
                // Reposter fields
                'reposter_account.id as reposter_id',
                'reposter_account.name as reposter_name',
                'reposter_account.username as reposter_username',
                'reposter_account.url as reposter_url',
                'reposter_account.avatar_url as reposter_avatar_url',
                this.db.raw('0 as reposter_followed_by_current_user'),
            )
            .innerJoin('posts', 'posts.id', 'likes.post_id')
            .innerJoin(
                'accounts as author_account',
                'author_account.id',
                'posts.author_id',
            )
            .leftJoin('reposts', function () {
                this.on('reposts.post_id', 'posts.id').andOnVal(
                    'reposts.account_id',
                    '=',
                    accountId.toString(),
                );
            })
            .leftJoin(
                'accounts as reposter_account',
                'reposter_account.id',
                'reposts.account_id',
            )
            .leftJoin('follows as follows_author', function () {
                this.on(
                    'follows_author.following_id',
                    'author_account.id',
                ).andOnVal(
                    'follows_author.follower_id',
                    '=',
                    accountId.toString(),
                );
            })
            .where('likes.account_id', accountId)
            .modify((query) => {
                if (cursor) {
                    query.where('likes.id', '<', cursor);
                }
            })
            .where('posts.in_reply_to', null)
            .orderBy('likes.id', 'desc')
            .limit(limit + 1);

        const results = await query;

        const hasMore = results.length > limit;
        const paginatedResults = results.slice(0, limit);
        const lastResult = paginatedResults[paginatedResults.length - 1];

        return {
            results: paginatedResults.map((result: GetProfileDataResultRow) =>
                this.mapToPostDTO(result, accountId),
            ),
            nextCursor: hasMore ? lastResult.likes_id.toString() : null,
        };
    }

    /**
     * Map a database result row to a PostDTO
     * @param result - The database result row
     * @param contextAccountId - The ID of the account that is viewing the posts
     * @returns A PostDTO
     */
    mapToPostDTO(
        result: GetProfileDataResultRow,
        contextAccountId: number,
    ): PostDTO {
        return {
            id: result.post_ap_id,
            type: result.post_type,
            title: result.post_title ?? '',
            excerpt: result.post_excerpt ?? '',
            summary: result.post_summary ?? null,
            content: result.post_content ?? '',
            url: result.post_url,
            featureImageUrl: result.post_image_url ?? null,
            publishedAt: result.post_published_at,
            likeCount: result.post_like_count,
            likedByMe: result.post_liked_by_current_user === 1,
            replyCount: result.post_reply_count,
            readingTimeMinutes: result.post_reading_time_minutes,
            attachments: result.post_attachments
                ? result.post_attachments.map((attachment) => ({
                      type: attachment.type ?? '',
                      mediaType: attachment.mediaType ?? '',
                      name: attachment.name ?? '',
                      url: attachment.url,
                  }))
                : [],
            author: {
                id: result.author_id.toString(),
                handle: getAccountHandle(
                    result.author_url ? new URL(result.author_url).host : '',
                    result.author_username,
                ),
                name: result.author_name ?? '',
                url: result.author_url ?? '',
                avatarUrl: result.author_avatar_url ?? '',
                followedByMe: result.author_followed_by_current_user === 1,
            },
            authoredByMe: result.author_id === contextAccountId,
            repostCount: result.post_repost_count,
            repostedByMe: result.post_reposted_by_current_user === 1,
            repostedBy: result.reposter_id
                ? {
                      id: result.reposter_id.toString(),
                      handle: getAccountHandle(
                          result.reposter_url
                              ? new URL(result.reposter_url).host
                              : '',
                          result.reposter_username,
                      ),
                      name: result.reposter_name ?? '',
                      url: result.reposter_url ?? '',
                      avatarUrl: result.reposter_avatar_url ?? '',
                      followedByMe:
                          result.reposter_followed_by_current_user === 1,
                  }
                : null,
        };
    }

    // TODO: Clean up the any type
    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
    mapActivityToPostDTO(activity: any): PostDTO {
        const object = activity.object;
        const actor = activity.actor;
        const attributedTo = object.attributedTo;

        return {
            id: object.id,
            type: object.type === 'Article' ? PostType.Article : PostType.Note,
            title: object.name || '',
            excerpt: object.preview?.content || '',
            summary: object.summary || null,
            content: object.content || '',
            url: object.url || '',
            featureImageUrl: object.image || null,
            publishedAt: new Date(object.published || ''),
            likeCount: 0,
            likedByMe: object.liked || false,
            replyCount: object.replyCount || 0,
            readingTimeMinutes: 0,
            attachments: object.attachment || [],
            author: {
                id: attributedTo.id,
                handle: getAccountHandle(
                    new URL(attributedTo.id).host,
                    attributedTo.preferredUsername,
                ),
                name: attributedTo.name || '',
                url: attributedTo.id,
                avatarUrl: attributedTo.icon?.url || '',
                followedByMe: attributedTo.followedByMe || false,
            },
            authoredByMe: object.authored || false,
            repostCount: object.repostCount || 0,
            repostedByMe: object.reposted || false,
            repostedBy:
                activity.type === 'Announce'
                    ? {
                          id: actor.id,
                          handle: getAccountHandle(
                              new URL(actor.id).host,
                              actor.preferredUsername,
                          ),
                          name: actor.name || '',
                          url: actor.id,
                          avatarUrl: actor.icon?.url || '',
                          followedByMe: actor.followedByMe || false,
                      }
                    : null,
        };
    }

    private async isLikedByAccount(postId: number, accountId: number) {
        const result = await this.db('likes')
            .where({
                post_id: postId,
                account_id: accountId,
            })
            .first();

        return result !== undefined;
    }

    private async isRepostedByAccount(postId: number, accountId: number) {
        const result = await this.db('reposts')
            .where({
                post_id: postId,
                account_id: accountId,
            })
            .first();

        return result !== undefined;
    }

    private async getByApId(apId: URL) {
        const result = await this.db('posts')
            .select('id', 'reply_count', 'repost_count')
            .whereRaw('posts.ap_id_hash = UNHEX(SHA2(?, 256))', [apId.href])
            .first();

        return result || null;
    }

    private async getAccountByApId(apId: URL) {
        const result = await this.db('accounts')
            .select('id', 'username', 'ap_id', 'url')
            .whereRaw('accounts.ap_id_hash = UNHEX(SHA2(?, 256))', [apId.href])
            .first();

        return result || null;
    }

    private async getMentionedAccount(
        apId: URL,
        name: string,
    ): Promise<Result<Mention, AccountFetchError>> {
        const accountResult = await this.getAccountByApId(apId);
        let account: Account | null = null;
        if (accountResult) {
            account = {
                id: accountResult.id,
                apId: new URL(accountResult.ap_id),
                username: accountResult.username,
                url: new URL(accountResult.url),
            } as Account;
        } else {
            try {
                const context = this.fedifyContextFactory.getFedifyContext();
                const documentLoader = await context.getDocumentLoader({
                    handle: 'index',
                });
                const actor = await lookupObject(apId, { documentLoader });

                if (actor === null) {
                    return error('not-found');
                }

                if (!isActor(actor)) {
                    return error('not-an-actor');
                }

                account = {
                    apId: actor.id,
                    username: actor.preferredUsername,
                    url: actor.url,
                } as Account;
            } catch (err) {
                return error('network-failure');
            }
        }

        return ok({
            name: name,
            href: apId,
            account,
        });
    }
}
