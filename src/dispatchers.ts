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
    Create,
    Follow,
    Group,
    Image,
    importJwk,
    Like,
    Note,
    Person,
    type Protocol,
    Undo,
    Update,
    verifyObject,
} from '@fedify/fedify';
import * as Sentry from '@sentry/node';

import type { AccountService } from '@/account/account.service';
import type { FollowersService } from '@/activitypub/followers.service';
import type { FedifyContext, FedifyRequestContext } from '@/app';
import { ACTIVITYPUB_COLLECTION_PAGE_SIZE } from '@/constants';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import {
    buildAnnounceActivityForPost,
    buildCreateActivityAndObjectFromPost,
} from '@/helpers/activitypub/activity';
import { isFollowedByDefaultSiteAccount } from '@/helpers/activitypub/actor';
import type { HostDataContextLoader } from '@/http/host-data-context-loader';
import { lookupActor, lookupObject } from '@/lookup-helpers';
import { OutboxType, type Post } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { PostService } from '@/post/post.service';

export const actorDispatcher = (hostDataContextLoader: HostDataContextLoader) =>
    async function actorDispatcher(
        ctx: FedifyRequestContext,
        identifier: string,
    ) {
        const hostData = await hostDataContextLoader.loadDataForHost(ctx.host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error('Site not found for {host}', {
                        host: ctx.host,
                    });
                    return null;
                case 'account-not-found':
                    ctx.data.logger.error('Account not found for {host}', {
                        host: ctx.host,
                    });
                    return null;
                case 'multiple-users-for-site':
                    ctx.data.logger.error('Multiple users found for {host}', {
                        host: ctx.host,
                    });
                    return null;
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        const person = new Person({
            id: new URL(account.apId),
            name: account.name,
            summary: account.bio,
            preferredUsername: account.username,
            icon: account.avatarUrl
                ? new Image({
                      url: new URL(account.avatarUrl),
                  })
                : null,
            image: account.bannerImageUrl
                ? new Image({
                      url: new URL(account.bannerImageUrl),
                  })
                : null,
            inbox: account.apInbox,
            outbox: account.apOutbox,
            following: account.apFollowing,
            followers: account.apFollowers,
            liked: account.apLiked,
            url: account.url || account.apId,
            publicKeys: (await ctx.getActorKeyPairs(identifier)).map(
                (key) => key.cryptographicKey,
            ),
        });

        return person;
    };

export const keypairDispatcher = (
    accountService: AccountService,
    hostDataContextLoader: HostDataContextLoader,
) =>
    async function keypairDispatcher(ctx: FedifyContext, identifier: string) {
        const hostData = await hostDataContextLoader.loadDataForHost(ctx.host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error(
                        'Site not found for {host} (identifier: {identifier})',
                        {
                            host: ctx.host,
                            identifier,
                        },
                    );
                    return [];
                case 'account-not-found':
                    ctx.data.logger.error(
                        'Account not found for {host} (identifier: {identifier})',
                        {
                            host: ctx.host,
                            identifier,
                        },
                    );
                    return [];
                case 'multiple-users-for-site':
                    ctx.data.logger.error(
                        'Multiple users found for {host} (identifier: {identifier})',
                        {
                            host: ctx.host,
                            identifier,
                        },
                    );
                    return [];
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        const keyPair = await accountService.getKeyPair(account.id);

        if (isError(keyPair)) {
            const error = getError(keyPair);
            switch (error) {
                case 'account-not-found':
                    ctx.data.logger.error(
                        'Account not found for {host} (identifier: {identifier})',
                        {
                            host: ctx.host,
                            identifier,
                        },
                    );
                    return [];
                case 'key-pair-not-found':
                    ctx.data.logger.error(
                        'Key pair not found for {host} (identifier: {identifier})',
                        {
                            host: ctx.host,
                            identifier,
                        },
                    );
                    return [];
                default:
                    exhaustiveCheck(error);
            }
        }

        const { publicKey, privateKey } = getValue(keyPair);

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
        } catch (error) {
            ctx.data.logger.error(
                'Could not parse keypair for {host} (identifier: {identifier}): {error}',
                {
                    host: ctx.host,
                    identifier,
                    error,
                },
            );
            return [];
        }
    };

export function createAcceptHandler(accountService: AccountService) {
    return async function handleAccept(ctx: FedifyContext, accept: Accept) {
        ctx.data.logger.debug('Handling Accept');
        const parsed = ctx.parseUri(accept.objectId);
        ctx.data.logger.debug('Parsed accept object', { parsed });
        if (!accept.id) {
            ctx.data.logger.debug('Accept missing id - exit');
            return;
        }

        const sender = await accept.getActor(ctx);
        ctx.data.logger.debug('Accept sender retrieved');
        if (sender === null || sender.id === null) {
            ctx.data.logger.debug('Sender missing, exit early');
            return;
        }

        const object = await accept.getObject();
        if (object instanceof Follow === false) {
            ctx.data.logger.debug('Accept object is not a Follow, exit early');
            return;
        }

        const recipient = await object.getActor();
        if (recipient === null || recipient.id === null) {
            ctx.data.logger.debug('Recipient missing, exit early');
            return;
        }

        // Parallelize JSON-LD serialization to reduce latency
        const [senderJson, acceptJson] = await Promise.all([
            sender.toJsonLd(),
            accept.toJsonLd(),
        ]);
        await Promise.all([
            ctx.data.globaldb.set([accept.id.href], acceptJson),
            ctx.data.globaldb.set([sender.id.href], senderJson),
        ]);

        // Record the account of the sender as well as the follow
        const followerAccountResult = await accountService.ensureByApId(
            recipient.id,
        );
        if (isError(followerAccountResult)) {
            ctx.data.logger.debug('Follower account not found, exit early');
            return;
        }
        const followerAccount = getValue(followerAccountResult);

        const ensureAccountToFollowResult = await accountService.ensureByApId(
            sender.id,
        );
        if (isError(ensureAccountToFollowResult)) {
            ctx.data.logger.debug('Account to follow not found, exit early');
            return;
        }
        const accountToFollow = getValue(ensureAccountToFollowResult);

        await accountService.followAccount(followerAccount, accountToFollow);
    };
}

export async function handleAnnouncedCreate(
    ctx: FedifyContext,
    announce: Announce,
    accountService: AccountService,
    postService: PostService,
    hostDataContextLoader: HostDataContextLoader,
) {
    ctx.data.logger.debug('Handling Announced Create');

    // Validate announced create activity is from a Group as we only support
    // announcements from Groups - See https://codeberg.org/fediverse/fep/src/branch/main/fep/1b12/fep-1b12.md
    const announcer = await announce.getActor(ctx);

    if (!(announcer instanceof Group)) {
        ctx.data.logger.debug('Create is not from a Group, exit early');

        return;
    }

    const hostData = await hostDataContextLoader.loadDataForHost(ctx.host);

    if (isError(hostData)) {
        const error = getError(hostData);
        switch (error) {
            case 'site-not-found':
                ctx.data.logger.error('Site not found for {host}', {
                    host: ctx.host,
                });
                throw new Error(`Site not found for host: ${ctx.host}`);
            case 'account-not-found':
                ctx.data.logger.error('Account not found for {host}', {
                    host: ctx.host,
                });
                throw new Error(`Account not found for host: ${ctx.host}`);
            case 'multiple-users-for-site':
                ctx.data.logger.error('Multiple users found for {host}', {
                    host: ctx.host,
                });
                throw new Error(`Multiple users found for host: ${ctx.host}`);
            default:
                exhaustiveCheck(error);
        }
    }

    const { site } = getValue(hostData);

    // Validate that the group is followed
    if (
        !(await isFollowedByDefaultSiteAccount(announcer, site, accountService))
    ) {
        ctx.data.logger.debug('Group is not followed, exit early');

        return;
    }

    let create: Create | null = null;
    let createJson: Awaited<ReturnType<Create['toJsonLd']>> | undefined;

    // Verify create activity
    create = (await announce.getObject()) as Create;

    if (!create.id) {
        ctx.data.logger.debug('Create missing id, exit early');

        return;
    }

    if (create.proofId || create.proofIds.length > 0) {
        ctx.data.logger.debug('Verifying create with proof(s)');

        // Cache the JSON-LD result to avoid redundant serialization later
        createJson = await create.toJsonLd();

        if ((await verifyObject(Create, createJson)) === null) {
            ctx.data.logger.info(
                'Create cannot be verified with provided proof(s), exit early',
            );

            return;
        }
    } else {
        ctx.data.logger.debug('Verifying create with network lookup');

        const lookupResult = await lookupObject(ctx, create.id);

        if (lookupResult === null) {
            ctx.data.logger.debug(
                'Create cannot be verified with network lookup due to inability to lookup object, exit early',
            );

            return;
        }

        if (
            lookupResult instanceof Create &&
            String(create.id) !== String(lookupResult.id)
        ) {
            ctx.data.logger.debug(
                'Create cannot be verified with network lookup due to local activity + remote activity ID mismatch, exit early',
            );

            return;
        }

        if (
            lookupResult instanceof Create &&
            lookupResult.id?.origin !== lookupResult.actorId?.origin
        ) {
            ctx.data.logger.debug(
                'Create cannot be verified with network lookup due to remote activity + actor origin mismatch, exit early',
            );

            return;
        }

        if (
            (lookupResult instanceof Note || lookupResult instanceof Article) &&
            create.objectId?.href !== lookupResult.id?.href
        ) {
            ctx.data.logger.debug(
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
            ctx.data.logger.debug('Remote create missing id, exit early');

            return;
        }
    }

    // Persist create activity - use cached JSON-LD if available (from proof verification)
    // Otherwise serialize now (happens when create was replaced via network lookup)
    if (!createJson) {
        createJson = await create.toJsonLd();
    }
    ctx.data.globaldb.set([create.id.href], createJson);

    if (!create.objectId) {
        ctx.data.logger.debug('Create object id missing, exit early');

        return;
    }

    // This handles storing the posts in the posts table
    const postResult = await postService.getByApId(create.objectId);

    if (isError(postResult)) {
        const error = getError(postResult);

        switch (error) {
            case 'upstream-error':
                ctx.data.logger.debug(
                    'Upstream error fetching post for create handling',
                    {
                        postId: create.objectId.href,
                    },
                );
                break;
            case 'not-a-post':
                ctx.data.logger.debug(
                    'Resource is not a post in create handling',
                    {
                        postId: create.objectId.href,
                    },
                );
                break;
            case 'missing-author':
                ctx.data.logger.debug(
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
            ctx.data.logger.debug('Announcer id missing, exit early');

            return;
        }

        const accountResult = await accountService.ensureByApId(announcer.id);

        if (isError(accountResult)) {
            ctx.data.logger.debug('Announcer account not found, exit early');

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
    async function handleUndo(ctx: FedifyContext, undo: Undo) {
        ctx.data.logger.debug('Handling Undo');

        if (!undo.id) {
            ctx.data.logger.debug('Undo missing an id - exiting');
            return;
        }

        const object = await undo.getObject();

        if (object instanceof Follow) {
            const follow = object as Follow;
            if (!follow.actorId || !follow.objectId) {
                ctx.data.logger.debug('Undo contains invalid Follow - exiting');
                return;
            }

            const unfollower = await accountService.getAccountByApId(
                follow.actorId.href,
            );
            if (!unfollower) {
                ctx.data.logger.debug('Could not find unfollower');
                return;
            }
            const unfollowing = await accountService.getAccountByApId(
                follow.objectId.href,
            );
            if (!unfollowing) {
                ctx.data.logger.debug('Could not find unfollowing');
                return;
            }

            await ctx.data.globaldb.set([undo.id.href], await undo.toJsonLd());

            await accountService.recordAccountUnfollow(unfollowing, unfollower);
        } else if (object instanceof Announce) {
            const sender = await object.getActor(ctx);
            if (sender === null || sender.id === null) {
                ctx.data.logger.debug(
                    'Undo announce activity sender missing, exit early',
                );
                return;
            }
            const senderAccount = await accountService.getByApId(sender.id);

            if (object.objectId === null) {
                ctx.data.logger.debug(
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
                            ctx.data.logger.debug(
                                'Upstream error fetching post for undoing announce',
                                {
                                    postId: object.objectId.href,
                                },
                            );
                            break;
                        case 'not-a-post':
                            ctx.data.logger.debug(
                                'Resource is not a post in undoing announce',
                                {
                                    postId: object.objectId.href,
                                },
                            );
                            break;
                        case 'missing-author':
                            ctx.data.logger.debug(
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
    hostDataContextLoader: HostDataContextLoader,
) {
    return async function handleAnnounce(
        ctx: FedifyContext,
        announce: Announce,
    ) {
        ctx.data.logger.debug('Handling Announce');

        if (!announce.id) {
            // Validate announce
            ctx.data.logger.debug('Invalid Announce - no id');
            return;
        }

        if (!announce.objectId) {
            ctx.data.logger.debug('Invalid Announce - no object id');
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
                hostDataContextLoader,
            );
        }

        // Validate sender
        const sender = await announce.getActor(ctx);

        if (sender === null || sender.id === null) {
            ctx.data.logger.debug('Announce sender missing, exit early');
            return;
        }

        // Lookup announced object - If not found in globalDb
        let object = null;
        const existing =
            (await ctx.data.globaldb.get([announce.objectId.href])) ?? null;

        if (!existing) {
            ctx.data.logger.debug(
                'Announce object not found in globalDb, performing network lookup',
            );
            // Reuse the already-fetched object from the Create check above
            // instead of calling lookupObject again
            object = announced;
        }

        if (!existing && !object) {
            // Validate object
            ctx.data.logger.debug('Invalid Announce - could not find object');
            return;
        }

        if (object && !object.id) {
            ctx.data.logger.debug(
                'Invalid Announce - could not find object id',
            );
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
            ctx.data.logger.debug('Storing object in globalDb');

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

        // This will save the account if it doesn't already exist
        const senderAccount = await accountService.getByApId(sender.id);

        if (senderAccount !== null) {
            // This will save the post if it doesn't already exist
            const postResult = await postService.getByApId(announce.objectId);

            if (isError(postResult)) {
                const error = getError(postResult);
                switch (error) {
                    case 'upstream-error':
                        ctx.data.logger.debug(
                            'Upstream error fetching post for reposting',
                            {
                                postId: announce.objectId.href,
                            },
                        );
                        break;
                    case 'not-a-post':
                        ctx.data.logger.debug(
                            'Resource for reposting is not a post',
                            {
                                postId: announce.objectId.href,
                            },
                        );
                        break;
                    case 'missing-author':
                        ctx.data.logger.debug(
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
    return async function handleLike(ctx: FedifyContext, like: Like) {
        ctx.data.logger.debug('Handling Like');

        // Validate like
        if (!like.id) {
            ctx.data.logger.debug('Invalid Like - no id');
            return;
        }

        if (!like.objectId) {
            ctx.data.logger.debug('Invalid Like - no object id');
            return;
        }

        if (!like.actorId) {
            ctx.data.logger.debug('Invalid Like - no actor id');
            return;
        }

        const account = await accountService.getByApId(like.actorId);
        if (account !== null) {
            const postResult = await postService.getByApId(like.objectId);

            if (isError(postResult)) {
                const error = getError(postResult);
                switch (error) {
                    case 'upstream-error':
                        ctx.data.logger.debug(
                            'Upstream error fetching post for liking',
                            {
                                postId: like.objectId.href,
                            },
                        );
                        break;
                    case 'not-a-post':
                        ctx.data.logger.debug(
                            'Resource for liking is not a post',
                            {
                                postId: like.objectId.href,
                            },
                        );
                        break;
                    case 'missing-author':
                        ctx.data.logger.debug(
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
            ctx.data.logger.debug('Like sender missing, exit early');
            return;
        }

        // Lookup liked object - If not found in globalDb, perform network lookup
        let object = null;
        const existing =
            (await ctx.data.globaldb.get([like.objectId.href])) ?? null;

        if (!existing) {
            ctx.data.logger.debug(
                'Like object not found in globalDb, performing network lookup',
            );

            try {
                object = await like.getObject();
            } catch (err) {
                ctx.data.logger.debug(
                    'Error performing like object network lookup',
                    {
                        error: err,
                    },
                );
            }
        }

        // Validate object
        if (!existing && !object) {
            ctx.data.logger.debug('Invalid Like - could not find object');
            return;
        }

        if (object && !object.id) {
            ctx.data.logger.debug('Invalid Like - could not find object id');
            return;
        }

        // Persist like
        const likeJson = await like.toJsonLd();
        ctx.data.globaldb.set([like.id.href], likeJson);

        // Persist object if not already persisted
        if (!existing && object && object.id) {
            ctx.data.logger.debug('Storing object in globalDb');

            const objectJson = await object.toJsonLd();

            ctx.data.globaldb.set([object.id.href], objectJson);
        }
    };
}

export async function inboxErrorHandler(ctx: FedifyContext, error: unknown) {
    if (process.env.USE_MQ !== 'true') {
        Sentry.captureException(error);
    }
    ctx.data.logger.error('Error handling incoming activity: {error}', {
        error,
    });
}

export function createFollowersDispatcher(
    followersService: FollowersService,
    hostDataContextLoader: HostDataContextLoader,
) {
    return async function dispatchFollowers(
        ctx: FedifyContext,
        _handle: string,
    ) {
        const hostData = await hostDataContextLoader.loadDataForHost(ctx.host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error('Site not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Site not found for host: ${ctx.host}`);
                case 'account-not-found':
                    ctx.data.logger.error('Account not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Account not found for host: ${ctx.host}`);
                case 'multiple-users-for-site':
                    ctx.data.logger.error('Multiple users found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(
                        `Multiple users found for host: ${ctx.host}`,
                    );
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        const followers = await followersService.getFollowers(account.id);

        return {
            items: followers,
        };
    };
}

export function createFollowingDispatcher(
    accountService: AccountService,
    hostDataContextLoader: HostDataContextLoader,
) {
    return async function dispatchFollowing(
        ctx: FedifyRequestContext,
        _handle: string,
        cursor: string | null,
    ) {
        ctx.data.logger.debug('Following Dispatcher');

        const offset = Number.parseInt(cursor ?? '0', 10);
        let nextCursor: string | null = null;

        const host = ctx.request.headers.get('host')!;
        const hostData = await hostDataContextLoader.loadDataForHost(host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error('Site not found for {host}', {
                        host,
                    });
                    throw new Error(`Site not found for host: ${host}`);
                case 'account-not-found':
                    ctx.data.logger.error('Account not found for {host}', {
                        host,
                    });
                    throw new Error(`Account not found for host: ${host}`);
                case 'multiple-users-for-site':
                    ctx.data.logger.error('Multiple users found for {host}', {
                        host,
                    });
                    throw new Error(`Multiple users found for host: ${host}`);
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        const results = await accountService.getFollowingAccounts(account, {
            fields: ['ap_id'],
            limit: ACTIVITYPUB_COLLECTION_PAGE_SIZE,
            offset,
        });
        const totalFollowing = await accountService.getFollowingAccountsCount(
            account.id,
        );

        nextCursor =
            totalFollowing > offset + ACTIVITYPUB_COLLECTION_PAGE_SIZE
                ? (offset + ACTIVITYPUB_COLLECTION_PAGE_SIZE).toString()
                : null;

        ctx.data.logger.debug('Following results retrieved', {
            count: results.length,
        });

        return {
            items: results.map((result) => new URL(result.ap_id)),
            nextCursor,
        };
    };
}

export function createFollowersCounter(
    accountService: AccountService,
    hostDataContextLoader: HostDataContextLoader,
) {
    return async function countFollowers(
        ctx: FedifyRequestContext,
        _handle: string,
    ) {
        const hostData = await hostDataContextLoader.loadDataForHost(ctx.host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error('Site not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Site not found for host: ${ctx.host}`);
                case 'account-not-found':
                    ctx.data.logger.error('Account not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Account not found for host: ${ctx.host}`);
                case 'multiple-users-for-site':
                    ctx.data.logger.error('Multiple users found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(
                        `Multiple users found for host: ${ctx.host}`,
                    );
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        return await accountService.getFollowerAccountsCount(account.id);
    };
}

export function createFollowingCounter(
    accountService: AccountService,
    hostDataContextLoader: HostDataContextLoader,
) {
    return async function countFollowing(
        ctx: FedifyRequestContext,
        _handle: string,
    ) {
        const hostData = await hostDataContextLoader.loadDataForHost(ctx.host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error('Site not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Site not found for host: ${ctx.host}`);
                case 'account-not-found':
                    ctx.data.logger.error('Account not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Account not found for host: ${ctx.host}`);
                case 'multiple-users-for-site':
                    ctx.data.logger.error('Multiple users found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(
                        `Multiple users found for host: ${ctx.host}`,
                    );
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        return await accountService.getFollowingAccountsCount(account.id);
    };
}

export function followingFirstCursor() {
    return '0';
}

export function createOutboxDispatcher(
    postService: PostService,
    hostDataContextLoader: HostDataContextLoader,
) {
    return async function outboxDispatcher(
        ctx: FedifyRequestContext,
        _handle: string,
        cursor: string | null,
    ) {
        ctx.data.logger.debug('Outbox Dispatcher');

        const host = ctx.request.headers.get('host')!;
        const hostData = await hostDataContextLoader.loadDataForHost(host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error('Site not found for {host}', {
                        host,
                    });
                    throw new Error(`Site not found for host: ${host}`);
                case 'account-not-found':
                    ctx.data.logger.error('Account not found for {host}', {
                        host,
                    });
                    throw new Error(`Account not found for host: ${host}`);
                case 'multiple-users-for-site':
                    ctx.data.logger.error('Multiple users found for {host}', {
                        host,
                    });
                    throw new Error(`Multiple users found for host: ${host}`);
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        const outbox = await postService.getOutboxForAccount(
            account.id,
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
                    account,
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

export function createOutboxCounter(
    postService: PostService,
    hostDataContextLoader: HostDataContextLoader,
) {
    return async function countOutboxItems(ctx: FedifyRequestContext) {
        const hostData = await hostDataContextLoader.loadDataForHost(ctx.host);

        if (isError(hostData)) {
            const error = getError(hostData);
            switch (error) {
                case 'site-not-found':
                    ctx.data.logger.error('Site not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Site not found for host: ${ctx.host}`);
                case 'account-not-found':
                    ctx.data.logger.error('Account not found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(`Account not found for host: ${ctx.host}`);
                case 'multiple-users-for-site':
                    ctx.data.logger.error('Multiple users found for {host}', {
                        host: ctx.host,
                    });
                    throw new Error(
                        `Multiple users found for host: ${ctx.host}`,
                    );
                default:
                    exhaustiveCheck(error);
            }
        }

        const { account } = getValue(hostData);

        return await postService.getOutboxItemCount(account.id);
    };
}

export function outboxFirstCursor() {
    return new Date().toISOString();
}

export async function likedDispatcher(
    _ctx: FedifyRequestContext,
    _handle: string,
    _cursor: string | null,
) {
    return {
        items: [],
        nextCursor: null,
    };
}

export async function likedCounter(
    _ctx: FedifyRequestContext,
    _handle: string,
) {
    return 0;
}

export function likedFirstCursor() {
    return null;
}

export async function articleDispatcher(
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
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
    ctx: FedifyRequestContext,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Undo, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Undo.fromJsonLd(exists);
}

export async function nodeInfoDispatcher(_ctx: FedifyRequestContext) {
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
