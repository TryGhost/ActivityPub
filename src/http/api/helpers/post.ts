import type { Account } from 'account/account.entity';
import type { Post } from 'post/post.entity';
import { getAccountHandle } from '../../../account/utils';

import type { AuthorDTO, PostDTO, PostDTOV1 } from '../types';

function accountToAuthorDTO(
    account: Account,
    followedByMe: boolean,
): AuthorDTO {
    return {
        id: account.apId.href,
        name: account.name || '',
        handle: getAccountHandle(new URL(account.apId).host, account.username),
        avatarUrl: account.avatarUrl?.href || '',
        url: account.url.href,
        followedByMe,
    };
}

export function postToDTO(
    post: Post,
    meta: {
        authoredByMe: boolean;
        likedByMe: boolean;
        repostedByMe: boolean;
        repostedBy: Account[];
        followingAuthor: boolean;
        followingReposter: boolean;
    } = {
        authoredByMe: false,
        likedByMe: false,
        repostedByMe: false,
        repostedBy: [],
        followingAuthor: false,
        followingReposter: false,
    },
): PostDTO {
    return {
        id: post.apId.href,
        type: post.type,
        title: post.title ?? '',
        excerpt: post.excerpt ?? '',
        summary: post.summary ?? null,
        content: post.content ?? '',
        url: post.url.href,
        featureImageUrl: post.imageUrl?.href ?? null,
        publishedAt: post.publishedAt,
        likeCount: post.likeCount,
        likedByMe: meta.likedByMe,
        replyCount: post.replyCount,
        readingTimeMinutes: post.readingTimeMinutes,
        attachments: post.attachments.map((attachment) => {
            return {
                name: attachment.name ?? '',
                type: attachment.type ?? '',
                mediaType: attachment.mediaType ?? '',
                url: attachment.url.href,
            };
        }),
        author: accountToAuthorDTO(post.author, meta.followingAuthor),
        authoredByMe: meta.authoredByMe,
        repostCount: post.repostCount,
        repostedByMe: meta.repostedByMe,
        repostedBy: meta.repostedBy.map((account) =>
            accountToAuthorDTO(account, meta.followingReposter),
        ),
        metadata: post.metadata ?? {
            ghostAuthors: [],
        },
    };
}

/*
 * Mapping function to convert the PostDTO to the PostDTOV1 type for the v1 APIs.
 * This will be deprecated in v2 and we'll use the PostDTO type instead.
 */
export function postDTOToV1(post: PostDTO): PostDTOV1 {
    return {
        ...post,
        repostedBy: post.repostedBy.length === 0 ? null : post.repostedBy[0],
    };
}
