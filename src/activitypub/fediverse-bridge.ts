import type EventEmitter from 'node:events';

import {
    type Activity,
    Delete,
    Follow,
    PUBLIC_COLLECTION,
    Reject,
    Undo,
    Update,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import {
    AccountBlockedEvent,
    AccountUnfollowedEvent,
    AccountUpdatedEvent,
} from '@/account/events';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import {
    buildAnnounceActivityForPost,
    buildCreateActivityAndObjectFromPost,
    buildLikeActivityForPost,
    buildUndoAnnounceActivityForPost,
    buildUndoLikeActivityForPost,
    buildUpdateActivityAndObjectFromPost,
} from '@/helpers/activitypub/activity';
import { PostType } from '@/post/post.entity';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostDerepostedEvent } from '@/post/post-dereposted.event';
import { PostLikedEvent } from '@/post/post-liked.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';
import { PostUnlikedEvent } from '@/post/post-unliked.event';
import { PostUpdatedEvent } from '@/post/post-updated.event';

export class FediverseBridge {
    constructor(
        private readonly events: EventEmitter,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly accountService: AccountService,
    ) {}

    async init() {
        this.events.on(
            AccountUpdatedEvent.getName(),
            this.handleAccountUpdatedEvent.bind(this),
        );
        this.events.on(
            PostCreatedEvent.getName(),
            this.handlePostCreated.bind(this),
        );
        this.events.on(
            PostDeletedEvent.getName(),
            this.handlePostDeleted.bind(this),
        );
        this.events.on(
            PostUpdatedEvent.getName(),
            this.handlePostUpdated.bind(this),
        );
        this.events.on(
            AccountBlockedEvent.getName(),
            this.handleAccountBlockedEvent.bind(this),
        );
        this.events.on(
            PostLikedEvent.getName(),
            this.handlePostLiked.bind(this),
        );
        this.events.on(
            PostUnlikedEvent.getName(),
            this.handlePostUnliked.bind(this),
        );
        this.events.on(
            PostRepostedEvent.getName(),
            this.handlePostReposted.bind(this),
        );
        this.events.on(
            PostDerepostedEvent.getName(),
            this.handlePostDereposted.bind(this),
        );
        // Note: AccountFollowedEvent is NOT handled here because for external
        // follows, the Follow activity is sent BEFORE the relationship is
        // established (we wait for Accept). The event is emitted when Accept
        // is received, so we'd send a duplicate. Follow federation stays in
        // the controller for now.
        this.events.on(
            AccountUnfollowedEvent.getName(),
            this.handleAccountUnfollowed.bind(this),
        );
    }

    private async sendActivityToInbox(
        account: Account,
        recipient: Account,
        activity: Activity,
    ) {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        await ctx.sendActivity(
            { username: account.username },
            {
                id: recipient.apId,
                inboxId: recipient.apInbox,
            },
            activity,
        );
    }

    private async sendActivityToFollowers(
        account: Account,
        activity: Activity,
    ) {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        await ctx.sendActivity(
            { username: account.username },
            'followers',
            activity,
            {
                preferSharedInbox: true,
            },
        );
    }

    private async handlePostCreated(event: PostCreatedEvent) {
        const post = event.getPost();
        if (!post.author.isInternal) {
            return;
        }

        // TODO: Replies are currently handled in the handler file. Move that logic here.
        if (post.type === PostType.Note && post.inReplyTo) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();

        const { createActivity, fedifyObject } =
            await buildCreateActivityAndObjectFromPost(post, ctx);

        await ctx.data.globaldb.set(
            [createActivity.id!.href],
            await createActivity.toJsonLd(),
        );

        await ctx.data.globaldb.set(
            [fedifyObject.id!.href],
            await fedifyObject.toJsonLd(),
        );

        await this.sendActivityToFollowers(post.author, createActivity);
    }

    private async handlePostDeleted(event: PostDeletedEvent) {
        const post = event.getPost();
        if (!post.author.isInternal) {
            return;
        }
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const deleteActivity = new Delete({
            id: ctx.getObjectUri(Delete, { id: uuidv4() }),
            actor: post.author.apId,
            object: post.apId,
            to: PUBLIC_COLLECTION,
            cc: post.author.apFollowers,
        });

        await ctx.data.globaldb.set(
            [deleteActivity.id!.href],
            await deleteActivity.toJsonLd(),
        );

        await this.sendActivityToFollowers(post.author, deleteActivity);
    }

    private async handlePostUpdated(event: PostUpdatedEvent) {
        const post = event.getPost();
        if (!post.author.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();

        const { updateActivity, fedifyObject } =
            await buildUpdateActivityAndObjectFromPost(post, ctx);

        await ctx.data.globaldb.set(
            [updateActivity.id!.href],
            await updateActivity.toJsonLd(),
        );

        await ctx.data.globaldb.set(
            [fedifyObject.id!.href],
            await fedifyObject.toJsonLd(),
        );

        await this.sendActivityToFollowers(post.author, updateActivity);
    }

    private async handleAccountUpdatedEvent(event: AccountUpdatedEvent) {
        const account = event.getAccount();
        if (!account.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();

        const update = new Update({
            id: ctx.getObjectUri(Update, { id: uuidv4() }),
            actor: account.apId,
            to: PUBLIC_COLLECTION,
            object: account.apId,
            cc: account.apFollowers,
        });

        await ctx.data.globaldb.set([update.id!.href], await update.toJsonLd());

        await this.sendActivityToFollowers(account, update);
    }

    private async handleAccountBlockedEvent(event: AccountBlockedEvent) {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const blockerAccount = await this.accountService.getAccountById(
            event.getBlockerId(),
        );
        const blockedAccount = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!blockerAccount || !blockedAccount) {
            return;
        }

        if (blockedAccount.isInternal) {
            return;
        }

        const reject = new Reject({
            id: ctx.getObjectUri(Reject, { id: uuidv4() }),
            actor: blockerAccount.apId,
            object: new Follow({
                id: ctx.getObjectUri(Follow, { id: uuidv4() }),
                actor: blockedAccount.apId,
                object: blockerAccount.apId,
            }),
        });

        await ctx.data.globaldb.set([reject.id!.href], await reject.toJsonLd());

        await this.sendActivityToInbox(blockerAccount, blockedAccount, reject);
    }

    private async handlePostLiked(event: PostLikedEvent) {
        const post = event.getPost();
        const likerAccount = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!likerAccount?.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();
        const like = buildLikeActivityForPost(likerAccount, post, ctx);

        await ctx.data.globaldb.set([like.id!.href], await like.toJsonLd());

        // Send to post author if external
        if (!post.author.isInternal) {
            await this.sendActivityToInbox(likerAccount, post.author, like);
        }

        // Send to liker's followers
        await this.sendActivityToFollowers(likerAccount, like);
    }

    private async handlePostUnliked(event: PostUnlikedEvent) {
        const post = event.getPost();
        const unlikerAccount = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!unlikerAccount?.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();
        const undo = buildUndoLikeActivityForPost(unlikerAccount, post, ctx);

        await ctx.data.globaldb.set([undo.id!.href], await undo.toJsonLd());

        // Send to post author if external
        if (!post.author.isInternal) {
            await this.sendActivityToInbox(unlikerAccount, post.author, undo);
        }

        // Send to unliker's followers
        await this.sendActivityToFollowers(unlikerAccount, undo);
    }

    private async handlePostReposted(event: PostRepostedEvent) {
        const post = event.getPost();
        const reposterAccount = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!reposterAccount?.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();
        const announce = await buildAnnounceActivityForPost(
            reposterAccount,
            post,
            ctx,
        );

        await ctx.data.globaldb.set(
            [announce.id!.href],
            await announce.toJsonLd(),
        );

        // Send to post author if external
        if (!post.author.isInternal) {
            await this.sendActivityToInbox(
                reposterAccount,
                post.author,
                announce,
            );
        }

        // Send to reposter's followers
        await this.sendActivityToFollowers(reposterAccount, announce);
    }

    private async handlePostDereposted(event: PostDerepostedEvent) {
        const post = event.getPost();
        const dereposterAccount = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!dereposterAccount?.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();
        const undo = buildUndoAnnounceActivityForPost(
            dereposterAccount,
            post,
            ctx,
        );

        await ctx.data.globaldb.set([undo.id!.href], await undo.toJsonLd());

        // Send to post author if external
        if (!post.author.isInternal) {
            await this.sendActivityToInbox(
                dereposterAccount,
                post.author,
                undo,
            );
        }

        // Send to dereposter's followers
        await this.sendActivityToFollowers(dereposterAccount, undo);
    }

    private async handleAccountUnfollowed(event: AccountUnfollowedEvent) {
        const unfollowerAccount = await this.accountService.getAccountById(
            event.getUnfollowerId(),
        );
        const unfollowedAccount = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!unfollowerAccount || !unfollowedAccount) {
            return;
        }

        // Only federate if our user is unfollowing an external account
        if (!unfollowerAccount.isInternal || unfollowedAccount.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();

        const undo = new Undo({
            id: ctx.getObjectUri(Undo, { id: uuidv4() }),
            actor: unfollowerAccount.apId,
            object: new Follow({
                id: null,
                actor: unfollowerAccount.apId,
                object: unfollowedAccount.apId,
            }),
        });

        await ctx.data.globaldb.set([undo.id!.href], await undo.toJsonLd());

        await this.sendActivityToInbox(
            unfollowerAccount,
            unfollowedAccount,
            undo,
        );
    }
}
