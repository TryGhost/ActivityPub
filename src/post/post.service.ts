import {
    Activity,
    Article,
    CollectionPage,
    lookupObject,
    Note,
    isActor,
} from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { sanitizeHtml } from 'helpers/html';
import { isUri } from 'helpers/uri';
import type { PostDTO } from 'http/api/types';
import type { Knex } from 'knex';
import { Post, type PostAttachment, PostType } from './post.entity';
import type { KnexPostRepository } from './post.repository.knex';

interface BaseGetProfileDataResultRow {
    post_id: number;
    post_type: PostType;
    post_title: string | null;
    post_excerpt: string | null;
    post_content: string | null;
    post_url: string;
    post_image_url: string | null;
    post_published_at: Date;
    post_like_count: number;
    post_liked_by_user: 0 | 1;
    post_reply_count: number;
    post_reading_time_minutes: number;
    post_repost_count: number;
    post_reposted_by_user: 0 | 1;
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
}

interface GetProfileDataResultRowReposted extends BaseGetProfileDataResultRow {
    reposter_id: number;
    reposter_name: string | null;
    reposter_username: string;
    reposter_url: string | null;
    reposter_avatar_url: string | null;
}

interface GetProfileDataResultRowWithoutReposted
    extends BaseGetProfileDataResultRow {
    reposter_id: null;
    reposter_name: null;
    reposter_username: null;
    reposter_url: null;
    reposter_avatar_url: null;
}

export type GetProfileDataResultRow =
    | GetProfileDataResultRowReposted
    | GetProfileDataResultRowWithoutReposted;

export interface GetProfileDataResult {
    results: PostDTO[];
    nextCursor: string | null;
}

export class PostService {
    constructor(
        private readonly postRepository: KnexPostRepository,
        private readonly accountService: AccountService,
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    /**
     * Transforms a database result into a PostDTO
     * @param result Database result row
     * @param accountId Current account ID
     * @returns PostDTO object
     */
    private mapToPostDTO(
        result: GetProfileDataResultRow,
        accountId: number,
    ): PostDTO {
        return {
            id: result.post_ap_id,
            type: result.post_type,
            title: result.post_title ?? '',
            excerpt: result.post_excerpt ?? '',
            content: result.post_content ?? '',
            url: result.post_url,
            featureImageUrl: result.post_image_url ?? null,
            publishedAt: result.post_published_at,
            likeCount: result.post_like_count,
            likedByMe: result.post_liked_by_user === 1,
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
            },
            authoredByMe: result.author_id === accountId,
            repostCount: result.post_repost_count,
            repostedByMe: result.post_reposted_by_user === 1,
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
                  }
                : null,
        };
    }

    /**
     * Get the attachments for a post
     *
     * @param attachments
     */
    private async getPostAttachments(
        foundObject: Note | Article,
    ): Promise<PostAttachment[]> {
        const attachments = foundObject.getAttachments();
        const postAttachments: PostAttachment[] = [];

        for await (const attachment of attachments) {
            if (attachment instanceof Object) {
                const attachmentList = Array.isArray(attachment)
                    ? attachment
                    : [attachment].filter((a) => a !== undefined);
                for (const a of attachmentList) {
                    postAttachments.push({
                        type: a.type,
                        mediaType: a.mediaType,
                        name: a.name,
                        url: a.url,
                    });
                }
            }
        }
        return postAttachments;
    }

    async getByApId(id: URL): Promise<Post | null> {
        const post = await this.postRepository.getByApId(id);
        if (post) {
            return post;
        }

        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });
        const foundObject = await lookupObject(id, { documentLoader });

        // If foundObject is null - we could not find anything for this URL
        // Error because could be upstream server issues and we want a retry
        if (foundObject === null) {
            throw new Error(`Could not find Object ${id}`);
        }

        // If we do find an Object, and it's not a Note or Article
        // we return null because we're unable to handle it.
        if (
            !(foundObject instanceof Note) &&
            !(foundObject instanceof Article)
        ) {
            return null;
        }

        const type =
            foundObject instanceof Note ? PostType.Note : PostType.Article;

        // We're also unable to handle objects without an author
        if (!foundObject.attributionId) {
            return null;
        }

        const author = await this.accountService.getByApId(
            foundObject.attributionId,
        );

        if (author === null) {
            return null;
        }

        let inReplyTo = null;
        if (foundObject.replyTargetId) {
            inReplyTo = await this.getByApId(foundObject.replyTargetId);
        }

        const newlyCreatedPost = Post.createFromData(author, {
            type,
            title: foundObject.name?.toString(),
            content: foundObject.content?.toString(),
            imageUrl: foundObject.imageId,
            publishedAt: new Date(foundObject.published?.toString() || ''),
            url: foundObject.url instanceof URL ? foundObject.url : id,
            apId: id,
            inReplyTo,
            attachments: await this.getPostAttachments(foundObject),
        });

        await this.postRepository.save(newlyCreatedPost);

        return newlyCreatedPost;
    }

    /**
     * Get posts by an account
     *
     * @param accountId ID of the account to get posts for
     * @param limit Maximum number of posts to return
     * @param cursor Cursor to use for pagination
     */
    async getPostsByAccount(
        accountId: number,
        limit: number,
        cursor: string | null,
    ): Promise<GetProfileDataResult> {
        const query = this.db
            .select(
                // Post fields
                'posts_with_source.id as post_id',
                'posts_with_source.type as post_type',
                'posts_with_source.title as post_title',
                'posts_with_source.excerpt as post_excerpt',
                'posts_with_source.content as post_content',
                'posts_with_source.url as post_url',
                'posts_with_source.image_url as post_image_url',
                'posts_with_source.published_at as post_published_at',
                'posts_with_source.like_count as post_like_count',
                this.db.raw(
                    `CASE 
                        WHEN likes.post_id IS NOT NULL THEN 1 
                        ELSE 0 
                    END AS post_liked_by_user`,
                ),
                'posts_with_source.reply_count as post_reply_count',
                'posts_with_source.reading_time_minutes as post_reading_time_minutes',
                'posts_with_source.attachments as post_attachments',
                'posts_with_source.repost_count as post_repost_count',
                this.db.raw(
                    `CASE 
                        WHEN user_reposts.post_id IS NOT NULL THEN 1 
                        ELSE 0 
                    END AS post_reposted_by_user`,
                ),
                'posts_with_source.ap_id as post_ap_id',
                // Author fields (Who originally created the post)
                'author_account.id as author_id',
                'author_account.name as author_name',
                'author_account.username as author_username',
                'author_account.url as author_url',
                'author_account.avatar_url as author_avatar_url',
                // Reposter fields (If applicable)
                'reposter_account.id as reposter_id',
                'reposter_account.name as reposter_name',
                'reposter_account.username as reposter_username',
                'reposter_account.url as reposter_url',
                'reposter_account.avatar_url as reposter_avatar_url',
                // Unified `published_at` field for sorting
                'posts_with_source.published_date',
                'posts_with_source.deleted_at',
                'posts_with_source.in_reply_to',
            )
            .from(
                this.db
                    .select(
                        'posts.id',
                        'posts.type',
                        'posts.title',
                        'posts.excerpt',
                        'posts.content',
                        'posts.url',
                        'posts.image_url',
                        'posts.published_at',
                        'posts.like_count',
                        'posts.reply_count',
                        'posts.reading_time_minutes',
                        'posts.attachments',
                        'posts.repost_count',
                        'posts.ap_id',
                        'posts.author_id',
                        'posts.created_at',
                        'posts.deleted_at',
                        'posts.in_reply_to',
                        this.db.raw('NULL as reposter_id'),
                        this.db.raw(`'original' as source`),
                        this.db.raw('posts.published_at as published_date'),
                    )
                    .from('posts')
                    .where('posts.author_id', accountId)
                    .unionAll([
                        this.db
                            .select(
                                'posts.id',
                                'posts.type',
                                'posts.title',
                                'posts.excerpt',
                                'posts.content',
                                'posts.url',
                                'posts.image_url',
                                'posts.published_at',
                                'posts.like_count',
                                'posts.reply_count',
                                'posts.reading_time_minutes',
                                'posts.attachments',
                                'posts.repost_count',
                                'posts.ap_id',
                                'posts.author_id',
                                'reposts.created_at',
                                'posts.deleted_at',
                                'posts.in_reply_to',
                                'reposts.account_id as reposter_id',
                                this.db.raw(`'repost' as source`),
                                this.db.raw(
                                    'reposts.created_at as published_date',
                                ),
                            )
                            .from('reposts')
                            .innerJoin('posts', 'posts.id', 'reposts.post_id')
                            .where('reposts.account_id', accountId),
                    ])
                    .orderBy('published_date', 'desc') //Apply sorting at the union level
                    .as('posts_with_source'),
            )
            .innerJoin(
                'accounts as author_account',
                'author_account.id',
                'posts_with_source.author_id',
            )
            .leftJoin(
                'accounts as reposter_account',
                'reposter_account.id',
                'posts_with_source.reposter_id',
            )
            .leftJoin('likes', function () {
                this.on('likes.post_id', 'posts_with_source.id').andOnVal(
                    'likes.account_id',
                    '=',
                    accountId.toString(),
                );
            })
            .leftJoin('reposts as user_reposts', function () {
                this.on(
                    'user_reposts.post_id',
                    'posts_with_source.id',
                ).andOnVal(
                    'user_reposts.account_id',
                    '=',
                    accountId.toString(),
                );
            })
            .modify((query) => {
                if (cursor) {
                    query.where(
                        'posts_with_source.published_date',
                        '<',
                        cursor,
                    );
                }
            })
            .where('posts_with_source.deleted_at', null)
            .where('posts_with_source.in_reply_to', null)
            .orderBy('posts_with_source.published_date', 'desc')
            .limit(limit + 1);

        const results = await query;

        const hasMore = results.length > limit;
        const paginatedResults = results.slice(0, limit);
        const lastResult = paginatedResults[paginatedResults.length - 1];

        return {
            results: paginatedResults.map((result: GetProfileDataResultRow) =>
                this.mapToPostDTO(result, accountId),
            ),
            nextCursor: hasMore ? lastResult.published_date : null,
        };
    }

    /**
     * Get posts liked by an account
     *
     * @param accountId ID of the account to get posts for
     * @param limit Maximum number of posts to return
     * @param cursor Cursor to use for pagination
     */
    async getPostsLikedByAccount(
        accountId: number,
        limit: number,
        cursor: string | null,
    ): Promise<GetProfileDataResult> {
        const query = this.db('likes')
            .select(
                'likes.id as likes_id',
                // Post fields
                'posts.id as post_id',
                'posts.type as post_type',
                'posts.title as post_title',
                'posts.excerpt as post_excerpt',
                'posts.content as post_content',
                'posts.url as post_url',
                'posts.image_url as post_image_url',
                'posts.published_at as post_published_at',
                'posts.like_count as post_like_count',
                this.db.raw('1 AS post_liked_by_user'), // Since we are selecting from `likes`, this is always 1
                'posts.reply_count as post_reply_count',
                'posts.reading_time_minutes as post_reading_time_minutes',
                'posts.attachments as post_attachments',
                'posts.repost_count as post_repost_count',
                this.db.raw(
                    `CASE
                            WHEN reposts.post_id IS NOT NULL THEN 1
                            ELSE 0
                        END AS post_reposted_by_user`,
                ),
                'posts.ap_id as post_ap_id',
                // Author fields
                'author_account.id as author_id',
                'author_account.name as author_name',
                'author_account.username as author_username',
                'author_account.url as author_url',
                'author_account.avatar_url as author_avatar_url',
                // Reposter fields
                'reposter_account.id as reposter_id',
                'reposter_account.name as reposter_name',
                'reposter_account.username as reposter_username',
                'reposter_account.url as reposter_url',
                'reposter_account.avatar_url as reposter_avatar_url',
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
     * Get posts for an account using their handle
     *
     * @param handle - The handle to look up (e.g., "@username@domain")
     *
     */
    async getPostsByRemoteLookUp(
        defaultAccount: Account,
        handle: string,
        next: string,
    ): Promise<GetProfileDataResult | Error> {
        // If the next parameter is not a valid URI, return early
        if (!isUri(next)) {
            throw Error('Invalid next parameter');
        }

        // Lookup actor by handle
        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });
        const actor = await lookupObject(handle, { documentLoader });

        if (!isActor(actor)) {
            throw Error('Actor not found');
        }

        // Retrieve actor's posts
        // If a next parameter was provided, use it to retrieve a specific page of
        // posts. Otherwise, retrieve the first page of posts
        const result: GetProfileDataResult = {
            results: [],
            nextCursor: null,
        };

        let page: CollectionPage | null = null;

        try {
            if (next !== '') {
                // Ensure the next parameter is for the same host as the actor. We
                // do this to prevent blindly passing URIs to lookupObject (i.e next
                // param has been tampered with)
                // @TODO: Does this provide enough security? Can the host of the
                // actor be different to the host of the actor's followers collection?
                const { host: actorHost } = actor?.id || new URL('');
                const { host: nextHost } = new URL(next);

                if (actorHost !== nextHost) {
                    throw Error('Invalid Actor Host');
                }

                page = (await lookupObject(next, {
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
            throw Error('Error getting outbox');
        }

        if (!page) {
            throw Error('Page not found');
        }

        // Return result
        try {
            for await (const item of page.getItems()) {
                if (!(item instanceof Activity)) {
                    continue;
                }

                const object = await item.getObject();
                //const attributedTo = await object?.getAttribution();
                if (!object || !object.id) {
                    continue;
                }

                const activity = (await item.toJsonLd({
                    format: 'compact',
                })) as any;

                if (typeof activity.actor === 'string') {
                    activity.actor = await actor.toJsonLd({
                        format: 'compact',
                    });
                }

                if (typeof activity.object.attributedTo === 'string') {
                    const attributedTo = await lookupObject(
                        activity.object.attributedTo,
                        { documentLoader },
                    );
                    if (isActor(attributedTo)) {
                        activity.object.attributedTo =
                            await attributedTo.toJsonLd({
                                format: 'compact',
                            });
                    } else if (activity.type === 'Announce') {
                        // If the attributedTo is not an actor, it is a repost and we don't want to show it
                        continue;
                    }
                }

                const post = await this.postRepository.getByApId(object.id);

                const postDTO: PostDTO = {
                    id: object.id.toString(),
                    type: PostType.Article,
                    title: object.name?.toString() || '',
                    excerpt: object.summary?.toString() || '',
                    content: activity?.object?.content
                        ? sanitizeHtml(activity?.object?.content)
                        : '',
                    url: object.url?.toString() || '',
                    featureImageUrl: object.imageId?.toString() || '',
                    publishedAt: new Date(object.published?.toString() || ''),
                    likeCount: 0,
                    likedByMe: post
                        ? await this.postRepository.isLikedByAccount(
                              post.id!,
                              defaultAccount.id || 0, //Todo fix this
                          )
                        : false,
                    replyCount: post ? post.replyCount : 0,
                    readingTimeMinutes: 0,
                    author: {
                        id: activity.actor.id,
                        handle: getAccountHandle(
                            activity.actor.id.host || '',
                            activity.actor.id.username || '',
                        ),
                        name: activity.actor.name?.toString() || '',
                        url: activity.actor.id,
                        avatarUrl: activity.actor.icon.url?.toString() || '',
                    },
                    authoredByMe: defaultAccount.apId === activity.actor.id,
                    repostCount: post ? post.repostCount : 0,
                    repostedByMe: post
                        ? await this.postRepository.isRepostedByAccount(
                              post.id!,
                              defaultAccount.id || 0, //Todo fix this
                          )
                        : false,
                    repostedBy: null,
                    attachments: [],
                };

                if (activity.type === 'Announce') {
                    postDTO.repostedBy = {
                        id: activity.attributedTo.id,
                        handle: getAccountHandle(
                            activity.attributedTo.id.host || '',
                            activity.attributedTo.id.username || '',
                        ),
                        name: activity.attributedTo.name?.toString() || '',
                        url: activity.attributedTo.id,
                        avatarUrl:
                            activity.attributedTo.icon.url?.toString() || '',
                    };
                }

                result.results.push(postDTO);
            }
        } catch (err) {
            throw Error('Error getting posts');
        }

        result.nextCursor = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return result;
    }
}
