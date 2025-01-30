import type { AccountService } from '../../../account/account.service';
import { getAccountHandle } from '../../../account/utils';
import {
    ACTIVITY_OBJECT_TYPE_ARTICLE,
    ACTIVITY_OBJECT_TYPE_NOTE,
} from '../../../constants';
import { PostType } from '../../../feed/types';
import type {
    Activity,
    ActivityObject,
    ActivityObjectAttachment,
} from '../../../helpers/activitypub/activity';
import type { Post } from '../types';

/**
 * Get the author of a post from an activity: If the activity has attribution,
 * use that as the the author, otherwise use the activity actor as the author
 *
 * @param activity Activity
 * @param accountService Account service instance
 */
export async function getPostAuthor(
    activity: Activity,
    accountService: AccountService,
) {
    let activityPubId: string;

    if (typeof activity.actor === 'string') {
        activityPubId = activity.actor;
    } else {
        activityPubId = activity.actor.id;
    }

    if (activity.attributedTo && typeof activity.attributedTo === 'string') {
        activityPubId = activity.attributedTo;
    }

    if (activity.attributedTo && typeof activity.attributedTo === 'object') {
        activityPubId = activity.attributedTo.id;
    }

    const author = await accountService.getAccountByApId(activityPubId);

    return author;
}

/**
 * Get the excerpt of a post from an activity
 *
 * @param activity Activity
 */
export function getPostExcerpt(activity: Activity) {
    const object = activity.object as ActivityObject;

    if (object.type === ACTIVITY_OBJECT_TYPE_NOTE) {
        return '';
    }

    if (object.preview) {
        return object.preview.content ?? '';
    }

    return object.content
        .replace(/<[^>]*>/g, ' ') // Swap out HTML tags with a space
        .replace(/\s+/g, ' ') // Normalize all whitespace (newlines, multiple spaces) to single space
        .trim()
        .slice(0, 400);
}

/**
 * Get the feature image URL for a post from an activity
 *
 * @param activity Activity
 */
export function getPostFeatureImageUrl(activity: Activity): string | null {
    const object = activity.object as ActivityObject;

    if (typeof object.image === 'string') {
        return object.image;
    }

    if (typeof object.image === 'object' && object.image.url) {
        return object.image.url;
    }

    return null;
}

/**
 * Compute the reading time (in minutes) for a post's content
 *
 * @param content Post content
 */
export function getPostContentReadingTimeMinutes(content: string) {
    const WORDS_PER_MINUTE = 275;

    if (!content) return 0;

    const plainTextContent = content
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&[^;]+;/g, ' ') // Remove HTML entities
        .trim();

    const wordCount = plainTextContent
        .split(/\s+/)
        .filter((word) => word.length > 0).length;

    return Math.ceil(wordCount / WORDS_PER_MINUTE);
}

/**
 * Get the attachments for a post from an activity
 *
 * @param activity Activity
 */
export function getPostAttachments(
    activity: Activity,
): ActivityObjectAttachment[] {
    const object = activity.object as ActivityObject;

    return (
        Array.isArray(object.attachment)
            ? object.attachment
            : [object.attachment].filter(
                  (attachment) => attachment !== undefined,
              )
    ).map((attachment) => {
        return {
            type: attachment.type,
            mediaType: attachment.mediaType,
            name: attachment.name,
            url: attachment.url,
        };
    });
}

/**
 * Map an Activity to a Post
 *
 * @param activity Activity
 * @param accountService Account service instance
 */
export async function mapActivityToPost(
    activity: Activity,
    accountService: AccountService,
): Promise<Post | null> {
    const object = activity.object as ActivityObject;

    // At the moment it is possible that a post can be published without any
    // content, so we need to handle this case by using an empty string
    const postContent = object.content || '';

    const author = await getPostAuthor(activity, accountService);

    // If we can't find an author, we can't map the activity to a post, so we
    // return early
    if (!author) {
        return null;
    }

    return {
        // At the moment we don't have an internal ID so just use the Fediverse ID
        id: object.id,
        type:
            object.type === ACTIVITY_OBJECT_TYPE_ARTICLE
                ? PostType.Article
                : PostType.Note,
        title: object.name || '', // A note doesn't have a title
        excerpt: getPostExcerpt(activity),
        content: postContent,
        url: object.url,
        featureImageUrl: getPostFeatureImageUrl(activity),
        publishedAt: object.published,
        // `buildActivity` adds a `liked` property to the object if it
        // has been liked by the current user
        likeCount: object.liked ? 1 : 0,
        likedByMe: object.liked,
        // `buildActivity` adds a `replyCount` property to the object
        replyCount: object.replyCount,
        readingTimeMinutes: getPostContentReadingTimeMinutes(postContent),
        attachments: getPostAttachments(activity),
        author: {
            id: author.id.toString(),
            handle: getAccountHandle(
                new URL(author.ap_id).host,
                author.username,
            ),
            avatarUrl: author.avatar_url ?? '',
            name: author.name ?? '',
            url: author.url ?? '',
        },
        sharedBy: null,
    };
}
