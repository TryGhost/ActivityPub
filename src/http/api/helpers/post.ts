import type { Account } from 'account/account.entity';
import type { Post } from 'post/post.entity';
import { getAccountHandle } from '../../../account/utils';

import type { AuthorDTO, PostDTO } from '../types';

function accountToAuthorDTO(account: Account): AuthorDTO {
    return {
        id: account.apId.href,
        name: account.name || '',
        handle: getAccountHandle(new URL(account.apId).host, account.username),
        avatarUrl: account.avatarUrl?.href || '',
        url: account.url.href,
    };
}

export function postToDTO(
    post: Post,
    meta: {
        authoredByMe: boolean;
        likedByMe: boolean;
        repostedByMe: boolean;
        repostedBy: Account | null;
    } = {
        authoredByMe: false,
        likedByMe: false,
        repostedByMe: false,
        repostedBy: null,
    },
): PostDTO {
    return {
        id: post.apId.href,
        type: post.type,
        title: post.title ?? '',
        excerpt: post.excerpt ?? '',
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
        author: accountToAuthorDTO(post.author),
        authoredByMe: meta.authoredByMe,
        repostCount: post.repostCount,
        repostedByMe: meta.repostedByMe,
        repostedBy: meta.repostedBy
            ? accountToAuthorDTO(meta.repostedBy)
            : null,
        metadata: post.metadata ?? {
            ghostAuthors: [],
        },
    };
}
