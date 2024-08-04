import { Actor, Article, RequestContext, Create, KvStore, Note, PUBLIC_COLLECTION } from '@fedify/fedify';
import z from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { toURL } from '../../toURL';
import { v4 as uuidv4 } from 'uuid';
import { addToList } from 'kv-helpers';

export class PostPublishedHandler {
    static readonly method = 'post'
    static readonly url = '/.ghost/activitypub/webhooks/post/published'

    constructor(
        private readonly context: RequestContext<unknown>,
        private readonly globaldb: KvStore,
        private readonly localdb: KvStore,
        private readonly actor: Actor,
    ) {}

    async parse(body: unknown): Promise<PostPublishedWebhook> {
        return PostPublishedWebhook.parse(body);
    }

    async execute(body: PostPublishedWebhook): Promise<Response> {
        const [article, preview] = this.postToArticle(body.post.current);

        const create = new Create({
            actor: this.actor,
            object: article,
            id: this.context.getObjectUri(Create, { id: uuidv4() }),
            to: PUBLIC_COLLECTION,
            cc: this.context.getFollowersUri('index'),
        });

        await this.globaldb.set([preview.id!.href], await preview.toJsonLd());
        await this.globaldb.set([create.id!.href], await create.toJsonLd());
        await this.globaldb.set([article.id!.href], await article.toJsonLd());

        await addToList(this.localdb, ['outbox'], create.id!.href);

        await this.context.sendActivity(
            {
                handle: 'index'
            },
            'followers',
            create,
            {
                preferSharedInbox: true
            }
        );

        return new Response('OK', {
            headers: {
                'Content-Type': 'text/plain',
            },
            status: 200,
        });
    }

    postToArticle(post: Post): [Article, Note] {
        const preview = new Note({
            id: this.context.getObjectUri(Note, { id: post.uuid }),
            content: post.excerpt,
        });
        const article = new Article({
            id: this.context.getObjectUri(Article, { id: post.uuid }),
            name: post.title,
            content: post.html,
            image: toURL(post.feature_image),
            published: Temporal.Instant.from(post.published_at),
            preview: preview,
            url: toURL(post.url),
        });

        return [
            article,
            preview,
        ];
    }
}

const Post = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    html: z.string(),
    excerpt: z.string(),
    feature_image: z.string().url().nullable(),
    published_at: z.string().datetime(),
    url: z.string().url()
});

const PostPublishedWebhook = z.object({
    post: z.object({
        current: Post
    })
});

export type Post = z.infer<typeof Post>

export type PostPublishedWebhook = z.infer<typeof PostPublishedWebhook>
