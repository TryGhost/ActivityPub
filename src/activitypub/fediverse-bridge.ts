import type EventEmitter from 'node:events';
import {
    type Activity,
    type Actor,
    Article,
    Create,
    Delete,
    Note as FedifyNote,
    Follow,
    Image,
    Mention,
    PUBLIC_COLLECTION,
    type Recipient,
    Reject,
    Update,
    isActor,
    lookupObject,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountUpdatedEvent } from 'account/account-updated.event';
import type { AccountService } from 'account/account.service';
import { addToList } from 'kv-helpers';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { type Post, PostType } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import { v4 as uuidv4 } from 'uuid';
import type { FedifyContextFactory } from './fedify-context.factory';

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
        let fedifyObject: FedifyNote | Article | null = null;
        let createActivity: Create | null = null;

        if (post.type === PostType.Note) {
            if (post.inReplyTo) {
                let attributionActor: Actor | null = null;
                try {
                    [createActivity, fedifyObject, attributionActor] =
                        await this.getActivityDataForReply(post);
                } catch (error) {
                    ctx.data.logger.error(
                        'Error getting activity data for reply',
                        { postId: post.id, error },
                    );
                    return;
                }
                await this.sendActivityToRecipient(
                    createActivity,
                    post.author.username,
                    attributionActor,
                );
            } else {
                [createActivity, fedifyObject] =
                    await this.getActivityDataForNote(post);
            }
        } else if (post.type === PostType.Article) {
            [createActivity, fedifyObject] =
                await this.getActivityDataForArticle(post);
        }

        if (!createActivity) {
            return;
        }

        await ctx.data.globaldb.set(
            [createActivity.id!.href],
            await createActivity.toJsonLd(),
        );

        if (fedifyObject?.id!.href) {
            await ctx.data.globaldb.set(
                [fedifyObject?.id!.href],
                await fedifyObject?.toJsonLd(),
            );
        }

        await addToList(ctx.data.db, ['outbox'], createActivity.id!.href);

        await this.sendActivityToFollowers(
            createActivity,
            post.author.username,
        );
    }

    private async sendActivityToFollowers(activity: Activity, handle: string) {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        await ctx.sendActivity(
            {
                handle: handle,
            },
            'followers',
            activity,
            {
                preferSharedInbox: true,
            },
        );
    }

    private async sendActivityToRecipient(
        activity: Activity,
        handle: string,
        recipient: Recipient | Recipient[],
    ) {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        await ctx.sendActivity(
            {
                handle: handle,
            },
            recipient,
            activity,
            {
                preferSharedInbox: true,
            },
        );
    }

    private async getActivityDataForNote(
        post: Post,
    ): Promise<[Create, FedifyNote]> {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const fedifyObject = new FedifyNote({
            id: post.apId || ctx.getObjectUri(FedifyNote, { id: uuidv4() }),
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
        const createActivity = new Create({
            id: ctx.getObjectUri(Create, { id: uuidv4() }),
            actor: post.author.apId,
            object: fedifyObject,
            to: PUBLIC_COLLECTION,
            cc: post.author.apFollowers,
        });

        return [createActivity, fedifyObject];
    }

    private async getActivityDataForReply(
        reply: Post,
    ): Promise<[Create, FedifyNote, Actor]> {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const parentPost = await this.postRepository.getById(reply.inReplyTo);
        if (!parentPost) {
            ctx.data.logger.error(
                `Parent post not found for reply ${reply.id}`,
            );
            throw new Error('Parent post not found');
        }

        const documentLoader = await ctx.getDocumentLoader({
            handle: 'index',
        });
        const inReplyToId = parentPost.apId;

        const objectToReplyTo = await lookupObject(inReplyToId, {
            documentLoader,
        });

        if (!objectToReplyTo) {
            ctx.data.logger.error(
                `objectToReplyTo not found for reply ${reply.id}`,
            );
            throw new Error('objectToReplyTo not found');
        }

        let attributionActor = null;
        if (objectToReplyTo.attributionId) {
            attributionActor = await lookupObject(
                objectToReplyTo.attributionId.href,
                { documentLoader },
            );
        }

        if (!attributionActor || !isActor(attributionActor)) {
            ctx.data.logger.error(
                `attributionActor not found for reply ${reply.id} or it's not of type actor`,
            );
            throw new Error(
                'attributionActor not found or it is not of type actor',
            );
        }

        const conversation =
            objectToReplyTo.replyTargetId || objectToReplyTo.id!;
        const mentions = [
            new Mention({
                href: attributionActor.id,
                name: attributionActor.name,
            }),
        ];

        const cc = [];
        if (reply.author.apFollowers) {
            cc.push(reply.author.apFollowers);
        }
        if (attributionActor.id) {
            cc.push(attributionActor.id);
        }

        const fedifyObject = new FedifyNote({
            id: reply.apId || ctx.getObjectUri(FedifyNote, { id: uuidv4() }),
            attribution: reply.author.apId,
            replyTarget: objectToReplyTo,
            content: reply.content,
            attachments: reply.imageUrl
                ? [
                      new Image({
                          url: reply.imageUrl,
                      }),
                  ]
                : undefined,
            summary: null,
            published: Temporal.Now.instant(),
            contexts: [conversation],
            tags: mentions,
            to: PUBLIC_COLLECTION,
            ccs: cc,
        });

        const createActivity = new Create({
            id: ctx.getObjectUri(Create, { id: uuidv4() }),
            actor: reply.author.apId,
            object: fedifyObject,
            to: PUBLIC_COLLECTION,
            ccs: cc,
        });

        return [createActivity, fedifyObject, attributionActor];
    }

    private async getActivityDataForArticle(
        post: Post,
    ): Promise<[Create, Article]> {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const preview = new FedifyNote({
            id: ctx.getObjectUri(FedifyNote, { id: String(post.id) }),
            content: post.excerpt,
        });

        const fedifyObject = new Article({
            id: post.apId || ctx.getObjectUri(Article, { id: String(post.id) }),
            attribution: post.author.apId,
            name: post.title,
            content: post.content,
            image: post.imageUrl,
            published: Temporal.Instant.from(post.publishedAt.toISOString()),
            preview,
            url: post.url,
            to: PUBLIC_COLLECTION,
            cc: post.author.apFollowers,
        });

        const createActivity = new Create({
            id: ctx.getObjectUri(Create, { id: uuidv4() }),
            actor: post.author.apId,
            object: fedifyObject,
            to: PUBLIC_COLLECTION,
            cc: post.author.apFollowers,
        });

        return [createActivity, fedifyObject];
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

        await this.sendActivityToFollowers(
            deleteActivity,
            post.author.username,
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

        await this.sendActivityToFollowers(update, account.username);
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
