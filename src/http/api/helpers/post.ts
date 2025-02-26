import { isActor } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import type { Post } from 'post/post.entity';
import type { AccountService } from '../../../account/account.service';
import {
    getAccountHandle,
    mapActorToExternalAccountData,
} from '../../../account/utils';
import type { FedifyRequestContext } from '../../../app';
import {
    ACTIVITY_OBJECT_TYPE_ARTICLE,
    ACTIVITY_OBJECT_TYPE_NOTE,
    ACTIVITY_TYPE_ANNOUNCE,
} from '../../../constants';
import type {
    Activity,
    ActivityObject,
    ActivityObjectAttachment,
} from '../../../helpers/activitypub/activity';
import { lookupActor } from '../../../lookup-helpers';
import { PostType } from '../../../post/post.entity';
import type { AuthorDTO, PostDTO } from '../types';

/**
 * Get the author of a post from an activity: If the activity has attribution,
 * use that as the the author, otherwise use the activity actor as the author
 *
 * @param activity Activity
 * @param accountService Account service instance
 * @param fedifyCtx Fedify request context instance
 */
export async function getPostAuthor(
    activity: Activity,
    accountService: AccountService,
    fedifyCtx: FedifyRequestContext,
) {
    let activityPubId: string;

    if (typeof activity.actor === 'string') {
        activityPubId = activity.actor;
    } else {
        activityPubId = activity.actor.id;
    }

    const object = activity.object as ActivityObject;

    if (object.attributedTo && typeof object.attributedTo === 'string') {
        activityPubId = object.attributedTo;
    }

    if (object.attributedTo && typeof object.attributedTo === 'object') {
        activityPubId = object.attributedTo.id;
    }

    let author = await accountService.getAccountByApId(activityPubId);

    // If we can't find an author, and the activity is an announce, we need to
    // look up the actor and create a new account, as we may not have created
    // the account yet - currently, accounts only get created when a follow
    // occurs, but the user may not be following the original author of the
    // announced object. This won't be needed when we have the posts table as
    // this enforces that a post belongs to an account (so the account has to
    // exist prior to insertion into the posts table)
    if (!author && activity.type === ACTIVITY_TYPE_ANNOUNCE) {
        const actor = await lookupActor(fedifyCtx, activityPubId);

        if (isActor(actor)) {
            const externalAccountData =
                await mapActorToExternalAccountData(actor);

            author =
                await accountService.createExternalAccount(externalAccountData);
        }
    }

    return author;
}

/**
 * Get the author of a post from an activity without attribution
 *
 * @param activity Activity
 * @param accountService Account service instance
 */
export async function getPostAuthorWithoutAttribution(
    activity: Activity,
    accountService: AccountService,
) {
    let activityPubId: string;

    if (typeof activity.actor === 'string') {
        activityPubId = activity.actor;
    } else {
        activityPubId = activity.actor.id;
    }

    return accountService.getAccountByApId(activityPubId);
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
 * @param fedifyCtx Fedify request context instance
 */
export async function mapActivityToPost(
    activity: Activity,
    accountService: AccountService,
    fedifyCtx: FedifyRequestContext,
): Promise<PostDTO | null> {
    const object = activity.object as ActivityObject;

    // At the moment it is possible that a post can be published without any
    // content, so we need to handle this case by using an empty string
    const postContent = object.content || '';

    const author = await getPostAuthor(activity, accountService, fedifyCtx);

    // If we can't find an author, we can't map the activity to a post, so we
    // return early
    if (!author) {
        return null;
    }

    const post: PostDTO = {
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
        // When the activity is an announce, we want to use the published date of
        // the announce rather than the published date of the object
        publishedAt:
            activity.type === ACTIVITY_TYPE_ANNOUNCE
                ? activity.published
                : object.published,
        // `buildActivity` adds a `liked` property to the object if it
        // has been liked by the current user
        likeCount: object.liked ? 1 : 0,
        likedByMe: Boolean(object.liked),
        // `buildActivity` adds a `replyCount` property to the object
        replyCount: object.replyCount || 0,
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
        repostCount: object.repostCount ?? 0,
        repostedByMe: Boolean(object.reposted),
        repostedBy: null,
    };

    if (activity.type === ACTIVITY_TYPE_ANNOUNCE) {
        const repostedBy = await getPostAuthorWithoutAttribution(
            activity,
            accountService,
        );

        if (repostedBy) {
            post.repostedBy = {
                id: repostedBy.id.toString(),
                handle: getAccountHandle(
                    new URL(repostedBy.ap_id).host,
                    repostedBy.username,
                ),
                avatarUrl: repostedBy.avatar_url ?? '',
                name: repostedBy.name ?? '',
                url: repostedBy.url ?? '',
            };
            post.repostCount = 1;
        }
    }

    return post;
}

function accountToAuthorDTO(account: Account): AuthorDTO {
    return {
        id: account.apId.href,
        name: account.name || '',
        handle: account.username,
        avatarUrl: account.avatarUrl?.href || '',
        url: account.url.href,
    };
}

export function postToDTO(
    post: Post,
    meta: {
        likedByMe: boolean;
        repostedByMe: boolean;
        repostedBy: Account | null;
    } = {
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
        repostCount: post.repostCount,
        repostedByMe: meta.repostedByMe,
        repostedBy: meta.repostedBy
            ? accountToAuthorDTO(meta.repostedBy)
            : null,
    };
}
