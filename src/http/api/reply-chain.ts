import { unsafeUnwrap } from 'core/result';
import type { PostService } from 'post/post.service';
import type { AppContext } from '../../app';
import { postToDTO } from './helpers/post';

export class ReplyChainController {
    constructor(private readonly postService: PostService) {}

    async handleGetReplies(ctx: AppContext) {
        const account = ctx.get('account');
        const postResult = await this.postService.getByApId(
            new URL(ctx.req.param('post_ap_id')),
        );

        const post = unsafeUnwrap(postResult);

        const data = {
            ancestors: {
                chain: [
                    {
                        id: 'https://activitypub.ghost.org/.ghost/activitypub/article/6e36a7e3-f6b5-403a-bf40-3b8b1850afd8',
                        type: 0,
                        title: 'Metabolizing mentions',
                        excerpt: '',
                        summary:
                            "We got those pesky little @ symbols doing the things they're supposed to",
                        content:
                            "We got those pesky little @ symbols doing the things they're supposed to",
                        url: 'https://activitypub.ghost.org/metabolizing-mentions/',
                        featureImageUrl:
                            'https://activitypub.ghost.org/content/images/2025/05/johnonolan_a_lightly_scifi_themed_photograph_of_a_pug_astronaut_d454cc41-ce26-4ec1-8848-3a79a4524699.png',
                        publishedAt: '2025-05-29T08:46:35.000Z',
                        likeCount: 0,
                        likedByMe: false,
                        replyCount: 3,
                        readingTimeMinutes: 1,
                        attachments: [],
                        author: {
                            id: 'https://activitypub.ghost.org/.ghost/activitypub/users/index',
                            name: 'Building ActivityPub',
                            handle: '@index@activitypub.ghost.org',
                            avatarUrl:
                                'https://activitypub.ghost.org/content/images/2024/09/ghost-orb-white-squircle-07.png',
                            url: 'https://activitypub.ghost.org/',
                        },
                        authoredByMe: false,
                        repostCount: 0,
                        repostedByMe: false,
                        repostedBy: null,
                        metadata: {
                            ghostAuthors: [],
                        },
                    },
                ],
                next: null,
            },
            post: postToDTO(post, {
                authoredByMe: post.author.id === account.id,
                likedByMe: false,
                repostedByMe: false,
                repostedBy: null,
            }),
            children: [
                {
                    post: {
                        id: 'https://www.jannis.io/.ghost/activitypub/note/9d8615b7-dfcb-4442-a1e4-969de84ce88e',
                        type: 0,
                        title: '',
                        excerpt: '',
                        summary: null,
                        content:
                            "<p>Awesome! My shoutout: I really enjoyed reading about the journey @jbaty@social.lol took exploring ActivityPub on Ghost. There's some really good feedback in his journey 🤗</p>",
                        url: 'https://www.jannis.io/.ghost/activitypub/note/9d8615b7-dfcb-4442-a1e4-969de84ce88e',
                        featureImageUrl: null,
                        publishedAt: '2025-05-29T08:55:33.097Z',
                        likeCount: 0,
                        likedByMe: false,
                        replyCount: 1,
                        readingTimeMinutes: 1,
                        attachments: [],
                        author: {
                            id: 'https://www.jannis.io/.ghost/activitypub/users/index',
                            name: 'Jannis Fedoruk-Betschki',
                            handle: '@jannis@jannis.io',
                            avatarUrl:
                                'https://storage.googleapis.com/magicpages-activitypub/images%2F4dc59c5e-79ab-4be4-9a67-b18313603bcd%2F4226246c-6d8b-48d2-8be5-ac88eb3ca282.webp',
                            url: 'https://www.jannis.io/',
                        },
                        authoredByMe: false,
                        repostCount: 0,
                        repostedByMe: false,
                        repostedBy: null,
                        metadata: {
                            ghostAuthors: [],
                        },
                    },
                    chain: [
                        {
                            id: 'https://www.jannis.io/.ghost/activitypub/note/b245de8e-229a-4f66-b861-7fda612ec701',
                            type: 0,
                            title: '',
                            excerpt: '',
                            summary: null,
                            content:
                                '<p>...though for some reason the mentions are not working as expected. Just updated the Magic Pages server (including migrations), so hm....any idea, dear Ghost team?</p>',
                            url: 'https://www.jannis.io/.ghost/activitypub/note/b245de8e-229a-4f66-b861-7fda612ec701',
                            featureImageUrl: null,
                            publishedAt: '2025-05-29T08:56:37.339Z',
                            likeCount: 0,
                            likedByMe: false,
                            replyCount: 1,
                            readingTimeMinutes: 1,
                            attachments: [],
                            author: {
                                id: 'https://www.jannis.io/.ghost/activitypub/users/index',
                                name: 'Jannis Fedoruk-Betschki',
                                handle: '@jannis@jannis.io',
                                avatarUrl:
                                    'https://storage.googleapis.com/magicpages-activitypub/images%2F4dc59c5e-79ab-4be4-9a67-b18313603bcd%2F4226246c-6d8b-48d2-8be5-ac88eb3ca282.webp',
                                url: 'https://www.jannis.io/',
                            },
                            authoredByMe: false,
                            repostCount: 0,
                            repostedByMe: false,
                            repostedBy: null,
                            metadata: {
                                ghostAuthors: [],
                            },
                        },
                    ],
                    next: null,
                },
                {
                    post: {
                        id: 'https://john.onolan.org/.ghost/activitypub/note/0ee67bde-289b-4a01-9e6a-b730a4ee0c1a',
                        type: 0,
                        title: '',
                        excerpt: '',
                        summary: null,
                        content:
                            '<p>Def follow <a href="https://www.jannis.io/" data-profile="@jannis@www.jannis.io" rel="nofollow noopener noreferrer">@jannis@jannis.io</a> and all the cool work he\'s doing with <a href="https://www.magicpages.co/" data-profile="@hey@www.magicpages.co" rel="nofollow noopener noreferrer">@hey@magicpages.co</a> - and <a href="https://mastodon.social/@_elena" data-profile="@_elena@mastodon.social" rel="nofollow noopener noreferrer">@_elena@mastodon.social</a> is a great person to follow for anyone interested in the broader fediverse space!</p>',
                        url: 'https://john.onolan.org/.ghost/activitypub/note/0ee67bde-289b-4a01-9e6a-b730a4ee0c1a',
                        featureImageUrl: null,
                        publishedAt: '2025-05-29T09:01:40.411Z',
                        likeCount: 1,
                        likedByMe: false,
                        replyCount: 1,
                        readingTimeMinutes: 1,
                        attachments: [],
                        author: {
                            id: 'https://john.onolan.org/.ghost/activitypub/users/index',
                            name: "John O'Nolan",
                            handle: '@john@john.onolan.org',
                            avatarUrl:
                                'https://john.onolan.org/content/images/2024/03/gravatar-j10-square.jpg',
                            url: 'https://john.onolan.org/',
                        },
                        authoredByMe: false,
                        repostCount: 1,
                        repostedByMe: false,
                        repostedBy: null,
                        metadata: {
                            ghostAuthors: [],
                        },
                    },
                    chain: [
                        {
                            id: 'https://mastodon.social/users/_elena/statuses/114590342880912059',
                            type: 0,
                            title: '',
                            excerpt: '',
                            summary: null,
                            content:
                                '<p><span class="h-card"><a href="https://john.onolan.org/" class="u-url mention" data-profile="@john@john.onolan.org" rel="nofollow noopener noreferrer">@<span>john</span></a></span> aw thank you John! Day = made ☺️ <span class="h-card"><a href="https://www.jannis.io/" class="u-url mention" data-profile="@jannis@www.jannis.io" rel="nofollow noopener noreferrer">@<span>jannis</span></a></span> <span class="h-card"><a href="https://www.magicpages.co/" class="u-url mention" data-profile="@hey@www.magicpages.co" rel="nofollow noopener noreferrer">@<span>hey</span></a></span></p>',
                            url: 'https://mastodon.social/@_elena/114590342880912059',
                            featureImageUrl: null,
                            publishedAt: '2025-05-29T09:11:10.000Z',
                            likeCount: 1,
                            likedByMe: false,
                            replyCount: 0,
                            readingTimeMinutes: 1,
                            attachments: [],
                            author: {
                                id: 'https://mastodon.social/users/_elena',
                                name: 'Elena Rossini ⁂',
                                handle: '@_elena@mastodon.social',
                                avatarUrl:
                                    'https://files.mastodon.social/accounts/avatars/109/246/411/862/197/824/original/16b4d03c1b5adeaf.jpeg',
                                url: 'https://mastodon.social/@_elena',
                            },
                            authoredByMe: false,
                            repostCount: 0,
                            repostedByMe: false,
                            repostedBy: null,
                            metadata: {
                                ghostAuthors: [],
                            },
                        },
                    ],
                    next: null,
                },
                {
                    post: {
                        id: 'https://www.uebergabe.de/.ghost/activitypub/note/52cc1f5e-1514-4490-a4d7-b8c75973a925',
                        type: 0,
                        title: '',
                        excerpt: '',
                        summary: null,
                        content:
                            '<p>This awesome! Next up: Hashtags? Cheers and thanks for your work! And thanks to <a href="https://www.magicpages.co/" data-profile="@hey@www.magicpages.co" rel="nofollow noopener noreferrer">@index@magicpages.co</a></p>',
                        url: 'https://www.uebergabe.de/.ghost/activitypub/note/52cc1f5e-1514-4490-a4d7-b8c75973a925',
                        featureImageUrl: null,
                        publishedAt: '2025-05-29T09:51:28.138Z',
                        likeCount: 2,
                        likedByMe: false,
                        replyCount: 0,
                        readingTimeMinutes: 1,
                        attachments: [],
                        author: {
                            id: 'https://www.uebergabe.de/.ghost/activitypub/users/index',
                            name: 'Übergabe | Medien für die Pflege',
                            handle: '@index@uebergabe.de',
                            avatarUrl:
                                'https://www.uebergabe.de/content/images/2024/03/Uebergabe_Cover.jpg',
                            url: 'https://www.uebergabe.de/',
                        },
                        authoredByMe: false,
                        repostCount: 0,
                        repostedByMe: false,
                        repostedBy: null,
                        metadata: {
                            ghostAuthors: [],
                        },
                    },
                    chain: [],
                    next: null,
                },
            ],
            next: null,
        };

        return new Response(JSON.stringify(data), { status: 200 });
    }
}
