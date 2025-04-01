import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from 'account/account.entity';
import type { AppContext } from 'app';
import { Audience, Post, PostType } from 'post/post.entity';
import type { PostService } from 'post/post.service';
import type { Site } from 'site/site.service';
import { createGetPostHandler } from './post';

describe('Post API', () => {
    let site: Site;
    let account: Account;
    let postService: PostService;

    beforeEach(() => {
        vi.setSystemTime(new Date('2025-03-25T14:00:00Z'));

        site = {
            id: 123,
            host: 'example.com',
            webhook_secret: 'secret',
        };
        account = Account.createFromData({
            id: 456,
            uuid: 'f4ec91bd-56b7-406f-a174-91495df6e6c',
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foo bar',
            avatarUrl: new URL('https://example.com/avatars/foobar.png'),
            bannerImageUrl: new URL('https://example.com/banners/foobar.png'),
            site,
            apId: new URL('https://example.com/users/456'),
            url: new URL('https://example.com/users/456'),
            apFollowers: new URL('https://example.com/followers/456'),
        });
        postService = {} as PostService;
    });

    it('should return a post', async () => {
        const postApId = 'https://example.com/posts/123';

        const ctx = {
            req: {
                param: (key: string) => {
                    if (key === 'post_ap_id') {
                        return postApId;
                    }
                    return null;
                },
            },
            get: (key: string) => {
                if (key === 'site') {
                    return site;
                }
            },
        } as unknown as AppContext;

        postService.getByApId = vi.fn().mockImplementation((_postApId) => {
            if (_postApId.href === postApId) {
                return new Post(
                    123,
                    '259e92cb-5ac2-4d62-910f-ddea29b2cf55',
                    account,
                    PostType.Article,
                    Audience.Public,
                    'Test Post 123',
                    'Test Post 123 Excerpt',
                    'Test Post 123 Content',
                    new URL('https://example.com/posts/123'),
                    new URL('https://example.com/images/post-123.jpg'),
                    new Date(),
                    0,
                    0,
                    2,
                );
            }

            return null;
        });

        const handler = createGetPostHandler(postService);

        const response = await handler(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchFileSnapshot(
            './__snapshots__/post.json',
        );
    });

    it('should return 400 for invalid post AP ID', async () => {
        const postApId = 'not-a-url';

        const ctx = {
            req: {
                param: (key: string) => {
                    if (key === 'post_ap_id') {
                        return postApId;
                    }
                    return null;
                },
            },
            get: (key: string) => {
                if (key === 'site') {
                    return site;
                }
            },
        } as unknown as AppContext;

        const handler = createGetPostHandler(postService);
        const response = await handler(ctx);

        expect(response.status).toBe(400);
    });

    it('should return 404 when post is not found', async () => {
        const postApId = 'https://example.com/posts/non-existent';

        const ctx = {
            req: {
                param: (key: string) => {
                    if (key === 'post_ap_id') {
                        return postApId;
                    }
                    return null;
                },
            },
            get: (key: string) => {
                if (key === 'site') {
                    return site;
                }
            },
        } as unknown as AppContext;

        postService.getByApId = vi.fn().mockResolvedValue(null);

        const handler = createGetPostHandler(postService);
        const response = await handler(ctx);

        expect(response.status).toBe(404);
    });
});
