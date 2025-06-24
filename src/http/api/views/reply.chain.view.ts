import { getAccountHandle } from 'account/utils';
import { type Result, error, ok } from 'core/result';
import type { Knex } from 'knex';
import { PostType } from 'post/post.entity';
import z from 'zod';
import type { PostDTO } from '../types';

export type ReplyChain = {
    ancestors: {
        chain: PostDTO[];
        hasMore: boolean;
    };
    post: PostDTO;
    children: {
        post: PostDTO;
        chain: PostDTO[];
        hasMore: boolean;
    }[];
    next: string | null;
};

export type ReplyChainError = 'not-found';

const PostRowSchema = z.object({
    post_id: z.number(),
    post_type: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    post_title: z.string().nullable(),
    post_excerpt: z.string().nullable(),
    post_summary: z.string().nullable(),
    post_content: z.string().nullable(),
    post_url: z.string(),
    post_image_url: z.string().nullable(),
    post_published_at: z.date(),
    post_like_count: z.number(),
    post_liked_by_current_user: z.union([z.literal(0), z.literal(1)]),
    post_reply_count: z.number(),
    post_reading_time_minutes: z.number(),
    post_repost_count: z.number(),
    post_reposted_by_current_user: z.union([z.literal(0), z.literal(1)]),
    post_ap_id: z.string(),
    post_in_reply_to: z.number().nullable(),
    post_thread_root: z.number().nullable(),
    post_attachments: z
        .array(
            z.object({
                type: z.string().nullable().optional(),
                mediaType: z.string().nullable().optional(),
                name: z.string().nullable().optional(),
                url: z.string(),
            }),
        )
        .nullable(),
    post_deleted_at: z.date().nullable(),
    author_id: z.number(),
    author_name: z.string().nullable(),
    author_username: z.string(),
    author_url: z.string().nullable(),
    author_avatar_url: z.string().nullable(),
    author_followed_by_user: z.union([z.literal(0), z.literal(1)]),
});

export type PostRow = z.infer<typeof PostRowSchema>;

export class ReplyChainView {
    static readonly MAX_ANCESTOR_DEPTH = 10;
    static readonly MAX_CHILDREN_COUNT = 10;
    static readonly MAX_CHILDREN_DEPTH = 5;

    constructor(private readonly db: Knex) {}

    private mapToPostDTO(result: PostRow, contextAccountId: number): PostDTO {
        // If the post is deleted, return it as a tombstone
        if (result.post_deleted_at !== null) {
            return {
                id: result.post_ap_id,
                type: PostType.Tombstone,
                title: '',
                excerpt: '',
                summary: null,
                content: '',
                url: result.post_url,
                featureImageUrl: null,
                publishedAt: result.post_published_at,
                likeCount: result.post_like_count,
                likedByMe: false,
                replyCount: result.post_reply_count,
                readingTimeMinutes: result.post_reading_time_minutes,
                attachments: [],
                author: {
                    id: result.author_id.toString(),
                    handle: getAccountHandle(
                        result.author_url
                            ? new URL(result.author_url).host
                            : '',
                        result.author_username,
                    ),
                    name: result.author_name ?? '',
                    url: result.author_url ?? '',
                    avatarUrl: result.author_avatar_url ?? '',
                    followedByMe: false,
                },
                authoredByMe: result.author_id === contextAccountId,
                repostCount: result.post_repost_count,
                repostedByMe: false,
                repostedBy: null,
            };
        }

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
                followedByMe: result.author_followed_by_user === 1,
            },
            authoredByMe: result.author_id === contextAccountId,
            repostCount: result.post_repost_count,
            repostedByMe: result.post_reposted_by_current_user === 1,
            repostedBy: null,
        };
    }

    private async getAncestors(
        contextAccountId: number,
        postApId: URL,
    ): Promise<PostRow[]> {
        const db = this.db;
        const selectPostRow = this.selectPostRow(contextAccountId);
        const ancestorRows = await selectPostRow(
            db
                .withRecursive('ancestor_ids', (qb) => {
                    qb.select('id', 'in_reply_to', db.raw('0 AS depth'))
                        .from('posts')
                        .whereRaw('posts.ap_id_hash = UNHEX(SHA2(?, 256))', [
                            postApId.href,
                        ])
                        .unionAll(function () {
                            this.select(
                                'p.id',
                                'p.in_reply_to',
                                db.raw('ai.depth + 1'),
                            )
                                .from('ancestor_ids as ai')
                                .join('posts as p', 'p.id', 'ai.in_reply_to')
                                .whereNotNull('ai.in_reply_to')
                                .andWhere(
                                    'ai.depth',
                                    '<',
                                    ReplyChainView.MAX_ANCESTOR_DEPTH,
                                );
                        });
                })
                .from('ancestor_ids')
                .where('depth', '>', 0) // Skip the root post
                .orderBy('depth', 'desc')
                .join('posts', 'posts.id', 'ancestor_ids.id'),
        );

        return ancestorRows.map(PostRowSchema.parse);
    }

    private selectPostRow(
        contextAccountId: number,
    ): (qb: Knex.QueryBuilder) => Knex.QueryBuilder {
        return (qb) => {
            return qb
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
                    'posts.in_reply_to as post_in_reply_to',
                    'posts.thread_root as post_thread_root',
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
                    'posts.deleted_at as post_deleted_at',
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
                    END AS author_followed_by_user
                `),
                    // Account metadata fields
                    this.db.raw(`
                    CASE
                        WHEN likes.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS liked_by_account
                `),
                    this.db.raw(`
                    CASE
                        WHEN reposts.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS reposted_by_account
                `),
                )
                .join(
                    'accounts as author_account',
                    'author_account.id',
                    'posts.author_id',
                )
                .leftJoin('follows as follows_author', function () {
                    this.on(
                        'follows_author.following_id',
                        'author_account.id',
                    ).andOnVal(
                        'follows_author.follower_id',
                        '=',
                        contextAccountId,
                    );
                })
                .leftJoin('users', 'users.account_id', 'author_account.id')
                .leftJoin('sites', 'sites.id', 'users.site_id')
                .leftJoin('likes', function () {
                    this.on('likes.post_id', 'posts.id').andOnVal(
                        'likes.account_id',
                        '=',
                        contextAccountId,
                    );
                })
                .leftJoin('reposts', function () {
                    this.on('reposts.post_id', 'posts.id').andOnVal(
                        'reposts.account_id',
                        '=',
                        contextAccountId,
                    );
                });
        };
    }

    private async getChildren(
        contextAccountId: number,
        postId: number,
        cursor?: string,
    ): Promise<PostRow[]> {
        const db = this.db;
        const selectPostRow = this.selectPostRow(contextAccountId);
        const childrenRows = await selectPostRow(
            db
                .withRecursive('child_ids', (qb) => {
                    qb.select(
                        'ranked.id',
                        'ranked.reply_count',
                        'ranked.in_reply_to',
                        db.raw('0 AS depth'),
                        'ranked.top_level_child_index',
                    )
                        .from(function (this: Knex.QueryBuilder) {
                            let query = this.select(
                                'posts.id',
                                'posts.reply_count',
                                'posts.in_reply_to',
                                db.raw(
                                    'ROW_NUMBER() OVER (ORDER BY published_at) AS top_level_child_index',
                                ),
                            )
                                .from('posts')
                                .orderBy('published_at', 'asc')
                                .where('in_reply_to', postId)
                                .whereNull('posts.deleted_at');

                            if (cursor) {
                                query = query.andWhere(
                                    'posts.published_at',
                                    '>',
                                    cursor,
                                );
                            }

                            return query
                                .limit(ReplyChainView.MAX_CHILDREN_COUNT + 1) // +1 to check for next page
                                .as('ranked');
                        })
                        .unionAll(function () {
                            this.select(
                                'p.id',
                                'p.reply_count',
                                'p.in_reply_to',
                                db.raw('ci.depth + 1'),
                                'ci.top_level_child_index',
                            )
                                .from('posts as p')
                                .join(
                                    'child_ids as ci',
                                    'p.in_reply_to',
                                    'ci.id',
                                )
                                .where('ci.reply_count', '=', 1)
                                .whereNull('p.deleted_at')
                                .andWhere(
                                    'ci.depth',
                                    '<',
                                    ReplyChainView.MAX_CHILDREN_DEPTH + 1, // +1 to check for next page
                                );
                        }, true);
                })
                .from('child_ids')
                .orderBy('top_level_child_index', 'asc')
                .orderBy('depth', 'asc')
                .join('posts', 'posts.id', 'child_ids.id'),
        );

        return childrenRows.map(PostRowSchema.parse);
    }

    public async getReplyChain(
        accountId: number,
        postApId: URL,
        cursor?: string,
    ): Promise<Result<ReplyChain, ReplyChainError>> {
        const selectPostRow = this.selectPostRow(accountId);
        const exists = await selectPostRow(
            this.db
                .from('posts')
                .whereRaw('posts.ap_id_hash = UNHEX(SHA2(?, 256))', [
                    postApId.href,
                ])
                .whereNull('posts.deleted_at')
                .first(),
        );

        if (!exists) {
            return error('not-found');
        }

        const currentPost = PostRowSchema.parse(exists);

        const ancestors = await this.getAncestors(accountId, postApId);
        const childrenAndChains = await this.getChildren(
            accountId,
            currentPost.post_id,
            cursor,
        );

        const allChildren: {
            post: PostDTO;
            chain: PostDTO[];
            next: string | null;
        }[] = [];
        for (const post of childrenAndChains) {
            if (post.post_in_reply_to === currentPost.post_id) {
                allChildren.push({
                    post: this.mapToPostDTO(post, accountId),
                    chain: [],
                    next: null,
                });
            } else {
                const current = allChildren[allChildren.length - 1];
                current.chain.push(this.mapToPostDTO(post, accountId));
            }
        }

        const hasMoreChildren =
            allChildren.length > ReplyChainView.MAX_CHILDREN_COUNT;

        const children = allChildren
            .slice(0, ReplyChainView.MAX_CHILDREN_COUNT)
            .map((child) => ({
                post: child.post,
                chain: child.chain.slice(0, ReplyChainView.MAX_CHILDREN_DEPTH),
                hasMore: child.chain.length > ReplyChainView.MAX_CHILDREN_DEPTH,
            }));

        return ok({
            ancestors: {
                chain: ancestors.map((ancestor) =>
                    this.mapToPostDTO(ancestor, accountId),
                ),
                hasMore: !!ancestors[0]?.post_in_reply_to,
            },
            post: this.mapToPostDTO(currentPost, accountId),
            children,
            next: hasMoreChildren
                ? children[children.length - 1].post.publishedAt.toISOString()
                : null,
        });
    }
}
