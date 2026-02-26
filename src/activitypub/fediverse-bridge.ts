import type EventEmitter from 'node:events';

import {
    type Activity,
    Delete,
    Follow,
    PUBLIC_COLLECTION,
    Reject,
    Update,
} from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import { AccountBlockedEvent, AccountUpdatedEvent } from '@/account/events';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import {
    buildCreateActivityAndObjectFromPost,
    buildUpdateActivityAndObjectFromPost,
} from '@/helpers/activitypub/activity';
import { PostType } from '@/post/post.entity';
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
