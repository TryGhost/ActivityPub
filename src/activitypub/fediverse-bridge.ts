import type EventEmitter from 'node:events';
import {
    Article,
    Create,
    Delete,
    Note as FedifyNote,
    Follow,
    Image,
    PUBLIC_COLLECTION,
    Reject,
    Update,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountUpdatedEvent } from 'account/account-updated.event';
import type { AccountService } from 'account/account.service';
import { addToList } from 'kv-helpers';
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

        if (post.type === PostType.Note) {
            if (post.inReplyTo) {
                return;
            }
            fedifyObject = new FedifyNote({
                id: post.apId,
                attribution: post.author.apId,
                content: post.content,
                summary: null,
                published: Temporal.Now.instant(),
                attachments: post.imageUrl
                    ? [
                          new Image({
                              url: post.imageUrl,
                          }),
                      ]
                    : undefined,
                to: PUBLIC_COLLECTION,
                cc: post.author.apFollowers,
            });
        } else if (post.type === PostType.Article) {
            const preview = new FedifyNote({
                id: ctx.getObjectUri(FedifyNote, { id: String(post.id) }),
                content: post.excerpt,
            });
            fedifyObject = new Article({
                id: post.apId,
                attribution: post.author.apId,
                name: post.title,
                content: post.content,
                image: post.imageUrl,
                published: Temporal.Instant.from(
                    post.publishedAt.toISOString(),
                ),
                preview,
                url: post.url,
                to: PUBLIC_COLLECTION,
                cc: post.author.apFollowers,
            });
        } else {
            throw new Error(`Unsupported post type: ${post.type}`);
        }

        const createActivity = new Create({
            id: ctx.getObjectUri(Create, { id: uuidv4() }),
            actor: post.author.apId,
            object: fedifyObject,
            to: PUBLIC_COLLECTION,
            cc: post.author.apFollowers,
        });

        await ctx.data.globaldb.set(
            [createActivity.id!.href],
            await createActivity.toJsonLd(),
        );

        await ctx.data.globaldb.set(
            [fedifyObject.id!.href],
            await fedifyObject.toJsonLd(),
        );

        await addToList(ctx.data.db, ['outbox'], createActivity.id!.href);

        await ctx.sendActivity(
            {
                handle: post.author.username,
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
                handle: post.author.username,
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
                handle: account.username,
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
