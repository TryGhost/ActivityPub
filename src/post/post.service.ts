import { Article, Note, lookupObject } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
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
    results: GetProfileDataResultRow[];
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
                'profile_posts.id as post_id',
                'profile_posts.type as post_type',
                'profile_posts.title as post_title',
                'profile_posts.excerpt as post_excerpt',
                'profile_posts.content as post_content',
                'profile_posts.url as post_url',
                'profile_posts.image_url as post_image_url',
                'profile_posts.published_at as post_published_at',
                'profile_posts.like_count as post_like_count',
                this.db.raw(
                    `CASE 
                            WHEN likes.post_id IS NOT NULL THEN 1 
                            ELSE 0 
                        END AS post_liked_by_user`,
                ),
                'profile_posts.reply_count as post_reply_count',
                'profile_posts.reading_time_minutes as post_reading_time_minutes',
                'profile_posts.attachments as post_attachments',
                'profile_posts.repost_count as post_repost_count',
                this.db.raw(
                    `CASE 
                            WHEN user_reposts.post_id IS NOT NULL THEN 1 
                            ELSE 0 
                        END AS post_reposted_by_user`,
                ),
                'profile_posts.ap_id as post_ap_id',
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
                // Additional fields for final result
                'profile_posts.published_date',
                'profile_posts.deleted_at',
                'profile_posts.in_reply_to',
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
                    .orderBy('published_date', 'desc')
                    .as('profile_posts'),
            )
            .innerJoin(
                'accounts as author_account',
                'author_account.id',
                'profile_posts.author_id',
            )
            .leftJoin(
                'accounts as reposter_account',
                'reposter_account.id',
                'profile_posts.reposter_id',
            )
            .leftJoin('likes', function () {
                this.on('likes.post_id', 'profile_posts.id').andOnVal(
                    'likes.account_id',
                    '=',
                    accountId.toString(),
                );
            })
            .leftJoin('reposts as user_reposts', function () {
                this.on('user_reposts.post_id', 'profile_posts.id').andOnVal(
                    'user_reposts.account_id',
                    '=',
                    accountId.toString(),
                );
            })
            .modify((query) => {
                if (cursor) {
                    query.where('profile_posts.published_date', '<', cursor);
                }
            })
            .where('profile_posts.deleted_at', null)
            .where('profile_posts.in_reply_to', null)
            .orderBy('profile_posts.published_date', 'desc')
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
}
