import { getAccountHandle } from 'account/utils';
import type { Knex } from 'knex';
import z from 'zod';
import type { PostDTO } from '../types';

export type ReplyChain = {
    ancestors: {
        chain: PostDTO[];
        next: string | null;
    };
    post: PostDTO;
    children: {
        post: PostDTO;
        chain: PostDTO[];
        next: string | null;
    }[];
    next: string | null;
};

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
    post_attachments: z
        .array(
            z.object({
                type: z.string().nullable(),
                mediaType: z.string().nullable(),
                name: z.string().nullable(),
                url: z.string(),
            }),
        )
        .nullable(),
    author_id: z.number(),
    author_name: z.string().nullable(),
    author_username: z.string(),
    author_url: z.string().nullable(),
    author_avatar_url: z.string().nullable(),
});

type PostRow = z.infer<typeof PostRowSchema>;

export class ReplyChainView {
    static readonly MAX_ANCESTOR_DEPTH = 10;

    constructor(private readonly db: Knex) {}

    private mapToPostDTO(result: PostRow, contextAccountId: number): PostDTO {
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
            },
            authoredByMe: result.author_id === contextAccountId,
            repostCount: result.post_repost_count,
            repostedByMe: result.post_reposted_by_current_user === 1,
            repostedBy: null,
        };
    }

    private async getAncestors(contextAccountId: number, postApId: URL): Promise<PostRow[]> {
        const db = this.db;
        const selectPostRow = this.selectPostRow(contextAccountId);
        const ancestorRows = await selectPostRow(
            db
            .withRecursive('ancestor_ids', (qb) => {
                qb.select('id', 'in_reply_to', db.raw('0 AS depth'))
                    .from('posts')
                    .where('ap_id', postApId.href)
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
            .where('depth', '>', 0)
            .orderBy('depth', 'desc')
            .join('posts', 'posts.id', 'ancestor_ids.id')
        );

        return ancestorRows.map(PostRowSchema.parse);
    }

    private selectPostRow(contextAccountId: number): (qb: Knex.QueryBuilder) => Knex.QueryBuilder {
        return (qb) => {
            return qb.select(
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
        }
    }

    async getReplyChain(accountId: number, postApId: URL) {}
}
