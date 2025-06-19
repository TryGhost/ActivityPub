import {
    Article,
    Create,
    Note as FedifyNote,
    Image,
    Mention,
    PUBLIC_COLLECTION,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { FedifyContext } from 'app';
import { type Post, PostType } from 'post/post.entity';

export async function buildCreateActivityAndObjectFromPost(
    post: Post,
    ctx: FedifyContext,
): Promise<{ createActivity: Create; fedifyObject: FedifyNote | Article }> {
    let fedifyObject: FedifyNote | Article;
    let mentions: Mention[] = [];
    let ccs: URL[] = [];

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
            published: Temporal.Instant.from(post.publishedAt.toISOString()),
            preview,
            url: post.url,
            to: PUBLIC_COLLECTION,
            ccs: ccs,
        });
    } else {
        throw new Error(`Unsupported post type: ${post.type}`);
    }

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
