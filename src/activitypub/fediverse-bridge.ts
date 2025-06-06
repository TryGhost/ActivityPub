import type EventEmitter from 'node:events';
import {
    Article,
    Create,
    Delete,
    Note as FedifyNote,
    Follow,
    Image,
    Mention,
    PUBLIC_COLLECTION,
    Reject,
    Update,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountUpdatedEvent } from 'account/account-updated.event';
import type { AccountService } from 'account/account.service';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { PostType } from 'post/post.entity';
import { v4 as uuidv4 } from 'uuid';
import type { FedifyContextFactory } from './fedify-context.factory';

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
            AccountBlockedEvent.getName(),
            this.handleAccountBlockedEvent.bind(this),
        );
    }

    private async handlePostCreated(event: PostCreatedEvent) {
        const post = event.getPost();
        if (!post.author.isInternal) {
            return;
        }
        const ctx = this.fedifyContextFactory.getFedifyContext();
        let fedifyObject: FedifyNote | Article;

        let mentions: Mention[] = [];
        let ccs: URL[] = [];

        if (post.type === PostType.Note) {
            if (post.inReplyTo) {
                return;
            }
            mentions = post.mentions.map(
                (account) =>
                    new Mention({
                        name: `@${account.username}@${account.apId.hostname}`,
                        href: account.apId,
                    }),
            );
            ccs = [
                post.author.apFollowers,
                ...mentions.map((mention) => mention.href),
            ].filter((url) => url !== null);

            fedifyObject = new FedifyNote({
                id: post.apId,
                attribution: post.author.apId,
                content: post.content,
                summary: post.summary,
                published: Temporal.Now.instant(),
                attachments: post.attachments
                    ? post.attachments
                          .filter((attachment) => attachment.type === 'Image')
                          .map(
                              (attachment) =>
                                  new Image({
                                      url: attachment.url,
                                  }),
                          )
                    : undefined,
                tags: mentions,
                to: PUBLIC_COLLECTION,
                ccs: ccs,
            });
        } else if (post.type === PostType.Article) {
            const preview = new FedifyNote({
                id: ctx.getObjectUri(FedifyNote, { id: String(post.id) }),
                content: post.excerpt,
            });
            ccs = post.author.apFollowers ? [post.author.apFollowers] : [];

            fedifyObject = new Article({
                id: post.apId,
                attribution: post.author.apId,
                name: post.title,
                summary: post.summary,
                content: post.content,
                image: post.imageUrl,
                published: Temporal.Instant.from(
                    post.publishedAt.toISOString(),
                ),
                preview,
                url: post.url,
                to: PUBLIC_COLLECTION,
                ccs: ccs,
            });
        } else {
            throw new Error(`Unsupported post type: ${post.type}`);
        }

        const createActivity = new Create({
            id: ctx.getObjectUri(Create, { id: uuidv4() }),
            actor: post.author.apId,
            object: fedifyObject,
            to: PUBLIC_COLLECTION,
            ccs: ccs,
        });

        await ctx.data.globaldb.set(
            [createActivity.id!.href],
            await createActivity.toJsonLd(),
        );

        await ctx.data.globaldb.set(
            [fedifyObject.id!.href],
            await fedifyObject.toJsonLd(),
        );

        await ctx.sendActivity(
            {
                username: post.author.username,
            },
            'followers',
            createActivity,
            {
                preferSharedInbox: true,
            },
        );
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

        await ctx.sendActivity(
            {
                username: post.author.username,
            },
            'followers',
            deleteActivity,
            {
                preferSharedInbox: true,
            },
        );
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

        await ctx.sendActivity(
            {
                username: account.username,
            },
            'followers',
            update,
            {
                preferSharedInbox: true,
            },
        );
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

        await ctx.sendActivity(
            { username: blockerAccount.username },
            {
                id: blockedAccount.apId,
                inboxId: blockedAccount.apInbox,
            },
            reject,
        );
    }
}
