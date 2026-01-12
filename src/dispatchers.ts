/**
 * TODO: Break this file into separate class-based handlers/dispatchers
 * @see ADR-0005: Class-based architecture
 *
 * This file violates our architectural patterns and should be refactored.
 */

import {
    Accept,
    Announce,
    Article,
    type Context,
    Create,
    Follow,
    Group,
    Image,
    importJwk,
    Like,
    Note,
    Person,
    type Protocol,
    type RequestContext,
    Undo,
    Update,
    verifyObject,
} from '@fedify/fedify';
import * as Sentry from '@sentry/node';

import type { AccountService } from '@/account/account.service';
import type { FollowersService } from '@/activitypub/followers.service';
import type { FedifyContextData } from '@/app';
import { ACTIVITYPUB_COLLECTION_PAGE_SIZE } from '@/constants';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import {
    buildAnnounceActivityForPost,
    buildCreateActivityAndObjectFromPost,
} from '@/helpers/activitypub/activity';
import { isFollowedByDefaultSiteAccount } from '@/helpers/activitypub/actor';
import { lookupActor, lookupObject } from '@/lookup-helpers';
import { OutboxType, type Post } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { PostService } from '@/post/post.service';

export const actorDispatcher = () =>
    async function actorDispatcher(
        ctx: RequestContext<FedifyContextData>,
        identifier: string,
    ) {
        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) return null;

        const person = new Person({
            id: new URL(hostAccount.apId),
            name: hostAccount.name ?? '',
            summary: hostAccount.bio,
            preferredUsername: hostAccount.username,
            icon: hostAccount.avatarUrl
                ? new Image({
                      url: new URL(hostAccount.avatarUrl),
                  })
                : null,
            image: hostAccount.bannerImageUrl
                ? new Image({
                      url: new URL(hostAccount.bannerImageUrl),
                  })
                : null,
            inbox: hostAccount.apInbox ? new URL(hostAccount.apInbox) : null,
            outbox: hostAccount.apOutbox ? new URL(hostAccount.apOutbox) : null,
            following: hostAccount.apFollowing
                ? new URL(hostAccount.apFollowing)
                : null,
            followers: hostAccount.apFollowers
                ? new URL(hostAccount.apFollowers)
                : null,
            liked: hostAccount.apLiked ? new URL(hostAccount.apLiked) : null,
            url: hostAccount.url ? new URL(hostAccount.url) : null,
            publicKeys: (await ctx.getActorKeyPairs(identifier)).map(
                (key) => key.cryptographicKey,
            ),
        });

        return person;
    };

export const keypairDispatcher = (accountService: AccountService) =>
    async function keypairDispatcher(
        ctx: Context<FedifyContextData>,
        identifier: string,
    ) {
        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) {
            return [];
        }

        const result = await accountService.getKeyPair(hostAccount.id);

        if (isError(result)) {
            const error = getError(result);
            switch (error) {
                case 'account-not-found':
                    ctx.data.logger.error(
                        `Account not found for ${identifier}`,
                    );
                    return [];
                case 'not-internal-account':
                    ctx.data.logger.error(
                        `Account is not internal for ${identifier}`,
                    );
                    return [];
                default:
                    return exhaustiveCheck(error);
            }
        }

        const { publicKey, privateKey } = getValue(result);

        try {
            return [
                {
                    publicKey: await importJwk(
                        JSON.parse(publicKey) as JsonWebKey,
                        'public',
                    ),
                    privateKey: await importJwk(
                        JSON.parse(privateKey) as JsonWebKey,
                        'private',
                    ),
                },
            ];
        } catch (_err) {
            ctx.data.logger.warn(`Could not parse keypair for ${identifier}`);
            return [];
        }
    };

export function createAcceptHandler(accountService: AccountService) {
    return async function handleAccept(
        ctx: Context<FedifyContextData>,
        accept: Accept,
    ) {
        ctx.data.logger.info('Handling Accept');
        const parsed = ctx.parseUri(accept.objectId);
        ctx.data.logger.info('Parsed accept object', { parsed });
        if (!accept.id) {
            ctx.data.logger.info('Accept missing id - exit');
            return;
        }

        const sender = await accept.getActor(ctx);
        ctx.data.logger.info('Accept sender', { sender });
        if (sender === null || sender.id === null) {
            ctx.data.logger.info('Sender missing, exit early');
            return;
        }

        const object = await accept.getObject();
        if (object instanceof Follow === false) {
            ctx.data.logger.info('Accept object is not a Follow, exit early');
            return;
        }

        const recipient = await object.getActor();
        if (recipient === null || recipient.id === null) {
            ctx.data.logger.info('Recipient missing, exit early');
            return;
        }

        const senderJson = await sender.toJsonLd();
        const acceptJson = await accept.toJsonLd();
        ctx.data.globaldb.set([accept.id.href], acceptJson);
        ctx.data.globaldb.set([sender.id.href], senderJson);

        // Record the account of the sender as well as the follow
        const followerAccountResult = await accountService.ensureByApId(
            recipient.id,
        );
        if (isError(followerAccountResult)) {
            ctx.data.logger.info('Follower account not found, exit early');
            return;
        }
        const followerAccount = getValue(followerAccountResult);

        const ensureAccountToFollowResult = await accountService.ensureByApId(
            sender.id,
        );
        if (isError(ensureAccountToFollowResult)) {
            ctx.data.logger.info('Account to follow not found, exit early');
            return;
        }
        const accountToFollow = getValue(ensureAccountToFollowResult);

        await accountService.followAccount(followerAccount, accountToFollow);
    };
}

export async function handleAnnouncedCreate(
    ctx: Context<FedifyContextData>,
    announce: Announce,
    accountService: AccountService,
    postService: PostService,
) {
    ctx.data.logger.info('Handling Announced Create');

    // Validate announced create activity is from a Group as we only support
    // announcements from Groups - See https://codeberg.org/fediverse/fep/src/branch/main/fep/1b12/fep-1b12.md
    const announcer = await announce.getActor(ctx);

    if (!(announcer instanceof Group)) {
        ctx.data.logger.info('Create is not from a Group, exit early');

        return;
    }

    const hostSite = ctx.data.hostSite;
    if (!hostSite) {
        throw new Error(`Site not found for host: ${ctx.host}`);
    }

    // Validate that the group is followed
    if (
        !(await isFollowedByDefaultSiteAccount(
            announcer,
            hostSite,
            accountService,
        ))
    ) {
        ctx.data.logger.info('Group is not followed, exit early');

        return;
    }

    let create: Create | null = null;

    // Verify create activity
    create = (await announce.getObject()) as Create;

    if (!create.id) {
        ctx.data.logger.info('Create missing id, exit early');

        return;
    }

    if (create.proofId || create.proofIds.length > 0) {
        ctx.data.logger.info('Verifying create with proof(s)');

        if ((await verifyObject(Create, await create.toJsonLd())) === null) {
            ctx.data.logger.info(
                'Create cannot be verified with provided proof(s), exit early',
            );

            return;
        }
    } else {
        ctx.data.logger.info('Verifying create with network lookup');

        const lookupResult = await lookupObject(ctx, create.id);

        if (lookupResult === null) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to inability to lookup object, exit early',
            );

            return;
        }

        if (
            lookupResult instanceof Create &&
            String(create.id) !== String(lookupResult.id)
        ) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to local activity + remote activity ID mismatch, exit early',
            );

            return;
        }

        if (
            lookupResult instanceof Create &&
            lookupResult.id?.origin !== lookupResult.actorId?.origin
        ) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to remote activity + actor origin mismatch, exit early',
            );

            return;
        }

        if (
            (lookupResult instanceof Note || lookupResult instanceof Article) &&
            create.objectId?.href !== lookupResult.id?.href
        ) {
            ctx.data.logger.info(
                'Create cannot be verified with network lookup due to lookup returning Object and ID mismatch, exit early',
            );

            return;
        }

        // If everything checks out, use the remote create activity where we can
        // so that we can guarantee the integrity of the associated object (i.e
        // the object of the annouced activity has not been tampered with). We can
        // only do this if the lookupResult is a Create (which is not always the
        // case depending on the remote server's implementation - i.e WordPress is
        // returning the Note/Article object instead of a Create object).
        if (lookupResult instanceof Create) {
            create = lookupResult;
        }

        if (!create.id) {
            ctx.data.logger.info('Remote create missing id, exit early');

            return;
        }
    }

    // Persist create activity
    const createJson = await create.toJsonLd();
    ctx.data.globaldb.set([create.id.href], createJson);

    if (!create.objectId) {
        ctx.data.logger.info('Create object id missing, exit early');

        return;
    }

    // This handles storing the posts in the posts table
    const postResult = await postService.getByApId(create.objectId);

    if (isError(postResult)) {
        const error = getError(postResult);

        switch (error) {
            case 'upstream-error':
                ctx.data.logger.info(
                    'Upstream error fetching post for create handling',
                    {
                        postId: create.objectId.href,
                    },
                );
                break;
            case 'not-a-post':
                ctx.data.logger.info(
                    'Resource is not a post in create handling',
                    {
                        postId: create.objectId.href,
                    },
                );
                break;
            case 'missing-author':
                ctx.data.logger.info(
                    'Post has missing author in create handling',
                    {
                        postId: create.objectId.href,
                    },
                );
                break;
            default:
                exhaustiveCheck(error);
        }
    } else {
        // Add a repost of the post from the announcer so that followers of the
        // announcer can see the post in their feed
        const post = getValue(postResult);

        if (announcer.id === null) {
            ctx.data.logger.info('Announcer id missing, exit early');

            return;
        }

        const accountResult = await accountService.ensureByApId(announcer.id);

        if (isError(accountResult)) {
            ctx.data.logger.info('Announcer account not found, exit early');

            return;
        }

        const account = getValue(accountResult);

        post.addRepost(account);

        await postService.repostByApId(account, post.apId);
    }
}

export const createUndoHandler = (
    accountService: AccountService,
    postRepository: KnexPostRepository,
    postService: PostService,
) =>
    async function handleUndo(ctx: Context<FedifyContextData>, undo: Undo) {
        ctx.data.logger.info('Handling Undo');

        if (!undo.id) {
            ctx.data.logger.info('Undo missing an id - exiting');
            return;
        }

        const object = await undo.getObject();

        if (object instanceof Follow) {
            const follow = object as Follow;
            if (!follow.actorId || !follow.objectId) {
                ctx.data.logger.info('Undo contains invalid Follow - exiting');
                return;
            }

            const unfollower = await accountService.getAccountByApId(
                follow.actorId.href,
            );
            if (!unfollower) {
                ctx.data.logger.info('Could not find unfollower');
                return;
            }
            const unfollowing = await accountService.getAccountByApId(
                follow.objectId.href,
            );
            if (!unfollowing) {
                ctx.data.logger.info('Could not find unfollowing');
                return;
            }

            await ctx.data.globaldb.set([undo.id.href], await undo.toJsonLd());

            await accountService.recordAccountUnfollow(unfollowing, unfollower);
        } else if (object instanceof Announce) {
            const sender = await object.getActor(ctx);
            if (sender === null || sender.id === null) {
                ctx.data.logger.info(
                    'Undo announce activity sender missing, exit early',
                );
                return;
            }
            const senderAccount = await accountService.getByApId(sender.id);

            if (object.objectId === null) {
                ctx.data.logger.info(
                    'Undo announce activity object id missing, exit early',
                );
                return;
            }

            if (senderAccount !== null) {
                const originalPostResult = await postService.getByApId(
                    object.objectId,
                );

                if (isError(originalPostResult)) {
                    const error = getError(originalPostResult);
                    switch (error) {
                        case 'upstream-error':
                            ctx.data.logger.info(
                                'Upstream error fetching post for undoing announce',
                                {
                                    postId: object.objectId.href,
                                },
                            );
                            break;
                        case 'not-a-post':
                            ctx.data.logger.info(
                                'Resource is not a post in undoing announce',
                                {
                                    postId: object.objectId.href,
                                },
                            );
                            break;
                        case 'missing-author':
                            ctx.data.logger.info(
                                'Post has missing author in undoing announce',
                                {
                                    postId: object.objectId.href,
                                },
                            );
                            break;
                        default:
                            return exhaustiveCheck(error);
                    }
                    return;
                }
                const originalPost = getValue(originalPostResult);
                originalPost.removeRepost(senderAccount);
                await postRepository.save(originalPost);
            }
        }

        return;
    };

export function createAnnounceHandler(
    accountService: AccountService,
    postService: PostService,
    postRepository: KnexPostRepository,
) {
    return async function handleAnnounce(
        ctx: Context<FedifyContextData>,
        announce: Announce,
    ) {
        ctx.data.logger.info('Handling Announce');

        if (!announce.id) {
            // Validate announce
            ctx.data.logger.info('Invalid Announce - no id');
            return;
        }

        if (!announce.objectId) {
            ctx.data.logger.info('Invalid Announce - no object id');
            return;
        }

        // Check what was announced - If it's an Activity rather than an Object
        // (which can occur if the announcer is a Group - See
        // https://codeberg.org/fediverse/fep/src/branch/main/fep/1b12/fep-1b12.md),
        // we need to forward the announce on to an appropriate handler
        // This routing is something that should be handled by Fedify, but has
        // not yet been implemented - Tracked here: https://github.com/dahlia/fedify/issues/193
        const announced = await lookupObject(ctx, announce.objectId);

        if (announced instanceof Create) {
            return handleAnnouncedCreate(
                ctx,
                announce,
                accountService,
                postService,
            );
        }

        // Validate sender
        const sender = await announce.getActor(ctx);

        if (sender === null || sender.id === null) {
            ctx.data.logger.info('Announce sender missing, exit early');
            return;
        }

        // Lookup announced object - If not found in globalDb, perform network lookup
        let object = null;
        const existing =
            (await ctx.data.globaldb.get([announce.objectId.href])) ?? null;

        if (!existing) {
            ctx.data.logger.info(
                'Announce object not found in globalDb, performing network lookup',
            );
            object = await lookupObject(ctx, announce.objectId);
        }

        if (!existing && !object) {
            // Validate object
            ctx.data.logger.info('Invalid Announce - could not find object');
            return;
        }

        if (object && !object.id) {
            ctx.data.logger.info('Invalid Announce - could not find object id');
            return;
        }

        // Persist announce
        const announceJson = (await announce.toJsonLd()) as {
            object: object | string;
            [key: string]: unknown;
        };

        if (existing) {
            // If the announced object already exists in globalDb, set it on
            // the activity
            announceJson.object = existing;
        }

        if (!existing && object && object.id) {
            // Persist object if not already persisted
            ctx.data.logger.info('Storing object in globalDb');

            const objectJson = await object.toJsonLd();

            if (typeof objectJson === 'object' && objectJson !== null) {
                if (
                    'attributedTo' in objectJson &&
                    typeof objectJson.attributedTo === 'string'
                ) {
                    const actor = await lookupActor(
                        ctx,
                        objectJson.attributedTo,
                    );
                    objectJson.attributedTo = await actor?.toJsonLd();
                }
            }

            ctx.data.globaldb.set([object.id.href], objectJson);

            // Set the full object on the activity
            announceJson.object = objectJson as object;
        }

        ctx.data.globaldb.set([announce.id.href], announceJson);

        const hostSite = ctx.data.hostSite;
        if (!hostSite) {
            throw new Error(`Site not found for host: ${ctx.host}`);
        }

        // This will save the account if it doesn't already exist
        const senderAccount = await accountService.getByApId(sender.id);

        if (senderAccount !== null) {
            // This will save the post if it doesn't already exist
            const postResult = await postService.getByApId(announce.objectId);

            if (isError(postResult)) {
                const error = getError(postResult);
                switch (error) {
                    case 'upstream-error':
                        ctx.data.logger.info(
                            'Upstream error fetching post for reposting',
                            {
                                postId: announce.objectId.href,
                            },
                        );
                        break;
                    case 'not-a-post':
                        ctx.data.logger.info(
                            'Resource for reposting is not a post',
                            {
                                postId: announce.objectId.href,
                            },
                        );
                        break;
                    case 'missing-author':
                        ctx.data.logger.info(
                            'Post for reposting has missing author',
                            {
                                postId: announce.objectId.href,
                            },
                        );
                        break;
                    default:
                        return exhaustiveCheck(error);
                }
            } else {
                const post = getValue(postResult);
                post.addRepost(senderAccount);
                await postRepository.save(post);
            }
        }
    };
}

export function createLikeHandler(
    accountService: AccountService,
    postRepository: KnexPostRepository,
    postService: PostService,
) {
    return async function handleLike(
        ctx: Context<FedifyContextData>,
        like: Like,
    ) {
        ctx.data.logger.info('Handling Like');

        // Validate like
        if (!like.id) {
            ctx.data.logger.info('Invalid Like - no id');
            return;
        }

        if (!like.objectId) {
            ctx.data.logger.info('Invalid Like - no object id');
            return;
        }

        if (!like.actorId) {
            ctx.data.logger.info('Invalid Like - no actor id');
            return;
        }

        const account = await accountService.getByApId(like.actorId);
        if (account !== null) {
            const postResult = await postService.getByApId(like.objectId);

            if (isError(postResult)) {
                const error = getError(postResult);
                switch (error) {
                    case 'upstream-error':
                        ctx.data.logger.info(
                            'Upstream error fetching post for liking',
                            {
                                postId: like.objectId.href,
                            },
                        );
                        break;
                    case 'not-a-post':
                        ctx.data.logger.info(
                            'Resource for liking is not a post',
                            {
                                postId: like.objectId.href,
                            },
                        );
                        break;
                    case 'missing-author':
                        ctx.data.logger.info(
                            'Post for liking has missing author',
                            {
                                postId: like.objectId.href,
                            },
                        );
                        break;
                    default: {
                        return exhaustiveCheck(error);
                    }
                }
            } else {
                const post = getValue(postResult);
                post.addLike(account);
                await postRepository.save(post);
            }
        }

        // Validate sender
        const sender = await like.getActor(ctx);

        if (sender === null || sender.id === null) {
            ctx.data.logger.info('Like sender missing, exit early');
            return;
        }

        // Lookup liked object - If not found in globalDb, perform network lookup
        let object = null;
        const existing =
            (await ctx.data.globaldb.get([like.objectId.href])) ?? null;

        if (!existing) {
            ctx.data.logger.info(
                'Like object not found in globalDb, performing network lookup',
            );

            try {
                object = await like.getObject();
            } catch (err) {
                ctx.data.logger.info(
                    'Error performing like object network lookup',
                    {
                        error: err,
                    },
                );
            }
        }

        // Validate object
        if (!existing && !object) {
            ctx.data.logger.info('Invalid Like - could not find object');
            return;
        }

        if (object && !object.id) {
            ctx.data.logger.info('Invalid Like - could not find object id');
            return;
        }

        // Persist like
        const likeJson = await like.toJsonLd();
        ctx.data.globaldb.set([like.id.href], likeJson);

        // Persist object if not already persisted
        if (!existing && object && object.id) {
            ctx.data.logger.info('Storing object in globalDb');

            const objectJson = await object.toJsonLd();

            ctx.data.globaldb.set([object.id.href], objectJson);
        }
    };
}

export async function inboxErrorHandler(
    ctx: Context<FedifyContextData>,
    error: unknown,
) {
    if (process.env.USE_MQ !== 'true') {
        Sentry.captureException(error);
    }
    ctx.data.logger.error('Error handling incoming activity: {error}', {
        error,
    });
}

export function createFollowersDispatcher(followersService: FollowersService) {
    return async function dispatchFollowers(
        ctx: Context<FedifyContextData>,
        _handle: string,
    ) {
        const hostSite = ctx.data.hostSite;
        if (!hostSite) {
            throw new Error(`Site not found for host: ${ctx.host}`);
        }

        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) {
            throw new Error(`Account not found for host: ${ctx.host}`);
        }

        const followers = await followersService.getFollowers(hostAccount.id);

        return {
            items: followers,
        };
    };
}

export function createFollowingDispatcher(accountService: AccountService) {
    return async function dispatchFollowing(
        ctx: RequestContext<FedifyContextData>,
        _handle: string,
        cursor: string | null,
    ) {
        ctx.data.logger.info('Following Dispatcher');

        const offset = Number.parseInt(cursor ?? '0', 10);
        let nextCursor: string | null = null;

        const host = ctx.request.headers.get('host')!;

        const hostSite = ctx.data.hostSite;
        if (!hostSite) {
            throw new Error(`Site not found for host: ${host}`);
        }

        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) {
            throw new Error(`Account not found for host: ${host}`);
        }

        const results = await accountService.getFollowingAccounts(hostAccount, {
            fields: ['ap_id'],
            limit: ACTIVITYPUB_COLLECTION_PAGE_SIZE,
            offset,
        });
        const totalFollowing = await accountService.getFollowingAccountsCount(
            hostAccount.id,
        );

        nextCursor =
            totalFollowing > offset + ACTIVITYPUB_COLLECTION_PAGE_SIZE
                ? (offset + ACTIVITYPUB_COLLECTION_PAGE_SIZE).toString()
                : null;

        ctx.data.logger.info('Following results', { results });

        return {
            items: results.map((result) => new URL(result.ap_id)),
            nextCursor,
        };
    };
}

export function createFollowersCounter(accountService: AccountService) {
    return async function countFollowers(
        ctx: RequestContext<FedifyContextData>,
        _handle: string,
    ) {
        const hostSite = ctx.data.hostSite;
        if (!hostSite) {
            throw new Error(`Site not found for host: ${ctx.host}`);
        }

        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) {
            throw new Error(`Account not found for host: ${ctx.host}`);
        }

        return await accountService.getFollowerAccountsCount(hostAccount.id);
    };
}

export function createFollowingCounter(accountService: AccountService) {
    return async function countFollowing(
        ctx: RequestContext<FedifyContextData>,
        _handle: string,
    ) {
        const hostSite = ctx.data.hostSite;
        if (!hostSite) {
            throw new Error(`Site not found for host: ${ctx.host}`);
        }

        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) {
            throw new Error(`Account not found for host: ${ctx.host}`);
        }

        return await accountService.getFollowingAccountsCount(hostAccount.id);
    };
}

export function followingFirstCursor() {
    return '0';
}

export function createOutboxDispatcher(postService: PostService) {
    return async function outboxDispatcher(
        ctx: RequestContext<FedifyContextData>,
        _handle: string,
        cursor: string | null,
    ) {
        ctx.data.logger.info('Outbox Dispatcher');

        const host = ctx.request.headers.get('host')!;

        const hostSite = ctx.data.hostSite;
        if (!hostSite) {
            throw new Error(`Site not found for host: ${host}`);
        }

        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) {
            throw new Error(`Account not found for host: ${host}`);
        }

        const outbox = await postService.getOutboxForAccount(
            hostAccount.id,
            cursor,
            ACTIVITYPUB_COLLECTION_PAGE_SIZE,
        );
        const outboxItems = await Promise.all(
            outbox.items.map(async (item: { post: Post; type: OutboxType }) => {
                if (item.type === OutboxType.Original) {
                    const { createActivity } =
                        await buildCreateActivityAndObjectFromPost(
                            item.post,
                            ctx,
                        );
                    return createActivity;
                }
                const announceActivity = await buildAnnounceActivityForPost(
                    hostAccount,
                    item.post,
                    ctx,
                );
                return announceActivity;
            }),
        );

        return {
            items: outboxItems,
            nextCursor: outbox.nextCursor,
        };
    };
}

export function createOutboxCounter(postService: PostService) {
    return async function countOutboxItems(
        ctx: RequestContext<FedifyContextData>,
    ) {
        const hostSite = ctx.data.hostSite;
        if (!hostSite) {
            throw new Error(`Site not found for host: ${ctx.host}`);
        }

        const hostAccount = ctx.data.hostAccount;
        if (!hostAccount) {
            throw new Error(`Account not found for host: ${ctx.host}`);
        }

        return await postService.getOutboxItemCount(hostAccount.id);
    };
}

export function outboxFirstCursor() {
    return new Date().toISOString();
}

export async function likedDispatcher(
    _ctx: RequestContext<FedifyContextData>,
    _handle: string,
    _cursor: string | null,
) {
    return {
        items: [],
        nextCursor: null,
    };
}

export async function likedCounter(
    _ctx: RequestContext<FedifyContextData>,
    _handle: string,
) {
    return 0;
}

export function likedFirstCursor() {
    return null;
}

export async function articleDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Article, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Article.fromJsonLd(exists);
}

export async function followDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Follow, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Follow.fromJsonLd(exists);
}

export async function acceptDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Accept, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Accept.fromJsonLd(exists);
}

export async function createDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Create, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Create.fromJsonLd(exists);
}

export async function updateDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Update, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Update.fromJsonLd(exists);
}

export async function noteDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Note, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Note.fromJsonLd(exists);
}

export async function likeDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Like, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Like.fromJsonLd(exists);
}

export async function announceDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Announce, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Announce.fromJsonLd(exists);
}

export async function undoDispatcher(
    ctx: RequestContext<FedifyContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Undo, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Undo.fromJsonLd(exists);
}

export async function nodeInfoDispatcher(
    _ctx: RequestContext<FedifyContextData>,
) {
    return {
        software: {
            name: 'ghost',
            version: { major: 0, minor: 1, patch: 0 },
            homepage: new URL('https://ghost.org/'),
            repository: new URL('https://github.com/TryGhost/Ghost'),
        },
        protocols: ['activitypub'] as Protocol[],
        openRegistrations: false,
        usage: {
            users: {
                total: 1,
            },
            localPosts: 0,
            localComments: 0,
        },
    };
}
