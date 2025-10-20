import type { Account } from '@/account/account.entity';
import { getAccountHandle } from '@/account/utils';
import { parseURL } from '@/core/url';
import type { GetFeedDataResultRow } from '@/feed/feed.service';

export function feedResultToPostDTO(
    results: GetFeedDataResultRow[],
    myAccount: Account,
) {
    return results.map((result) => {
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
                    parseURL(result.author_url)?.host ?? '',
                    result.author_username,
                ),
                name: result.author_name ?? '',
                url: result.author_url ?? '',
                avatarUrl: result.author_avatar_url ?? '',
                followedByMe: result.author_followed_by_user === 1,
            },
            authoredByMe: result.author_id === myAccount.id,
            repostCount: result.post_repost_count,
            repostedByMe: result.post_reposted_by_user === 1,
            repostedBy: result.reposter_id
                ? {
                      id: result.reposter_id.toString(),
                      handle: getAccountHandle(
                          parseURL(result.reposter_url)?.host ?? '',
                          result.reposter_username,
                      ),
                      name: result.reposter_name ?? '',
                      url: result.reposter_url ?? '',
                      avatarUrl: result.reposter_avatar_url ?? '',
                      followedByMe: result.reposter_followed_by_user === 1,
                  }
                : null,
        };
    });
}
