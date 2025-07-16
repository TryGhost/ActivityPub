import { createHash, randomUUID } from 'node:crypto';
import {
    Announce,
    Article,
    Create,
    Note as FedifyNote,
    Image,
    Mention,
    PUBLIC_COLLECTION,
    Update,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Account } from 'account/account.entity';
import type { FedifyContext } from 'app';
import { type Post, PostType } from 'post/post.entity';

async function getFedifyObjectForPost(
    post: Post,
    ctx: FedifyContext,
): Promise<{ fedifyObject: FedifyNote | Article; ccs: URL[] }> {
    let fedifyObject: FedifyNote | Article;
    let mentions: Mention[] = [];
    let ccs: URL[] = [];
    const updatedAt = post.updatedAt
        ? Temporal.Instant.from(post.updatedAt.toISOString())
        : Temporal.Instant.from(post.publishedAt.toISOString());

    if (post.type === PostType.Note) {
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
            published: Temporal.Instant.from(post.publishedAt.toISOString()),
            updated: updatedAt,
            attachments: post.attachments
                ? post.attachments
                      .filter((attachment) => attachment.type === 'Image')
                      .map(
                          (attachment) =>
                              new Image({
                                  url: attachment.url,
                                  name: attachment.name,
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
            published: Temporal.Instant.from(post.publishedAt.toISOString()),
            updated: updatedAt,
            preview,
            url: post.url,
            to: PUBLIC_COLLECTION,
            ccs: ccs,
        });
    } else {
        throw new Error(`Unsupported post type: ${post.type}`);
    }
    return { fedifyObject, ccs };
}

export async function buildCreateActivityAndObjectFromPost(
    post: Post,
    ctx: FedifyContext,
): Promise<{ createActivity: Create; fedifyObject: FedifyNote | Article }> {
    const { fedifyObject, ccs } = await getFedifyObjectForPost(post, ctx);
    const createActivity = new Create({
        id: ctx.getObjectUri(Create, { id: post.uuid }),
        actor: post.author.apId,
        object: fedifyObject,
        to: PUBLIC_COLLECTION,
        ccs: ccs,
    });

    return {
        createActivity,
        fedifyObject,
    };
}

export async function buildUpdateActivityAndObjectFromPost(
    post: Post,
    ctx: FedifyContext,
): Promise<{ updateActivity: Update; fedifyObject: FedifyNote | Article }> {
    const { fedifyObject, ccs } = await getFedifyObjectForPost(post, ctx);
    const updateActivity = new Update({
        id: ctx.getObjectUri(Update, { id: randomUUID() }),
        actor: post.author.apId,
        object: fedifyObject,
        to: PUBLIC_COLLECTION,
        ccs: ccs,
    });

    return {
        updateActivity,
        fedifyObject,
    };
}

export async function buildAnnounceActivityForPost(
    account: Account,
    post: Post,
    ctx: FedifyContext,
): Promise<Announce> {
    const announceId = ctx.getObjectUri(Announce, {
        id: createHash('sha256').update(post.apId.href).digest('hex'),
    });

    const announce = new Announce({
        id: announceId,
        actor: account.apId,
        object: post.apId,
        to: PUBLIC_COLLECTION,
        cc: account.apFollowers,
    });

    return announce;
}
