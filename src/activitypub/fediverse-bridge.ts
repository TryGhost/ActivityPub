import type EventEmitter from 'node:events';

import {
    type Activity,
    Delete,
    Follow,
    PUBLIC_COLLECTION,
    Reject,
    Update,
} from '@fedify/vocab';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import { AccountBlockedEvent, AccountUpdatedEvent } from '@/account/events';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import {
    buildCreateActivityAndObjectFromPost,
    buildUpdateActivityAndObjectFromPost,
} from '@/helpers/activitypub/activity';
import { isPublicPost, type Post, PostType } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostUpdatedEvent } from '@/post/post-updated.event';

export class FediverseBridge {
    constructor(
        private readonly events: EventEmitter,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly accountService: AccountService,
        private readonly postRepository: KnexPostRepository,
        private readonly relayInboxes: URL[],
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

    /**
     * Send an activity about a public post to the configured relays, which
     * pass it on to the servers that subscribe to them
     */
    private async sendActivityToRelays(post: Post, activity: Activity) {
        // Replies aren't sent, as they are created outside of the bridge
        if (
            this.relayInboxes.length === 0 ||
            !isPublicPost(post) ||
            post.inReplyTo !== null
        ) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();

        await ctx.sendActivity(
            { username: post.author.username },
            // Relays are only known by their inbox, which also stands in for
            // their id, as Fedify skips recipients without one
            this.relayInboxes.map((inbox) => ({ id: inbox, inboxId: inbox })),
            activity,
        );
    }

    private async handlePostCreated(event: PostCreatedEvent) {
        const post = await this.postRepository.getById(event.getPostId());
        if (!post) {
            return;
        }

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
        await this.sendActivityToRelays(post, createActivity);
    }

    private async handlePostDeleted(event: PostDeletedEvent) {
        if (!event.isAuthorInternal()) {
            return;
        }

        const account = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!account || !account.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();
        const deleteActivity = new Delete({
            id: ctx.getObjectUri(Delete, { id: uuidv4() }),
            actor: account.apId,
            object: new URL(event.getPostApId()),
            to: PUBLIC_COLLECTION,
            cc: account.apFollowers,
        });

        await ctx.data.globaldb.set(
            [deleteActivity.id!.href],
            await deleteActivity.toJsonLd(),
        );

        await this.sendActivityToFollowers(account, deleteActivity);

        if (this.relayInboxes.length > 0) {
            // Deleted posts are kept, so it can be checked whether the post
            // was sent to the relays
            const post = await this.postRepository.getById(event.getPostId());

            if (post) {
                await this.sendActivityToRelays(post, deleteActivity);
            }
        }
    }

    private async handlePostUpdated(event: PostUpdatedEvent) {
        const post = await this.postRepository.getById(event.getPostId());
        if (!post || !post.author.isInternal) {
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
        await this.sendActivityToRelays(post, updateActivity);
    }

    private async handleAccountUpdatedEvent(event: AccountUpdatedEvent) {
        const account = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!account || !account.isInternal) {
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
}
