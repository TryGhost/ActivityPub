import { describe, expect, it, vi } from 'vitest';

import type { AccountService } from '../../../account/account.service';
import type { FedifyRequestContext } from '../../../app';
import {
    ACTIVITY_OBJECT_TYPE_ARTICLE,
    ACTIVITY_OBJECT_TYPE_NOTE,
    ACTIVITY_TYPE_ANNOUNCE,
} from '../../../constants';
import type { Activity } from '../../../helpers/activitypub/activity';
import { PostType } from '../../../post/post.entity';
import {
    getPostAttachments,
    getPostAuthor,
    getPostAuthorWithoutAttribution,
    getPostContentReadingTimeMinutes,
    getPostExcerpt,
    getPostFeatureImageUrl,
    mapActivityToPost,
} from './post';

describe('getPostAuthor', () => {
    it('should return the correct author if the activity actor is a string', async () => {
        const activity = {
            actor: 'https://example.com/users/foo',
            object: {},
        } as unknown as Activity;

        const expectedAccount = {
            ap_id: 'https://example.com/users/foo',
        };

        const mockAccountService = {
            getAccountByApId: vi.fn().mockImplementation((id) => {
                if (id === activity.actor) {
                    return expectedAccount;
                }

                return null;
            }),
        } as unknown as AccountService;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await getPostAuthor(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result).toEqual(expectedAccount);
    });

    it('should return the correct author if the activity actor is an object', async () => {
        const activity = {
            actor: {
                id: 'https://example.com/users/foo',
            },
            object: {},
        } as unknown as Activity;

        const expectedAccount = {
            ap_id: 'https://example.com/users/foo',
        };

        const mockAccountService = {
            getAccountByApId: vi.fn().mockImplementation((id) => {
                if (id === activity.actor.id) {
                    return expectedAccount;
                }

                return null;
            }),
        } as unknown as AccountService;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await getPostAuthor(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result).toEqual(expectedAccount);
    });

    it('should return the correct author if the activity has attribution as a string', async () => {
        const activity = {
            actor: 'https://example.com/users/foo',
            object: {
                attributedTo: 'https://example.com/users/bar',
            },
        } as unknown as Activity;

        const actorAccount = {
            ap_id: 'https://example.com/users/foo',
        };
        const attributedAccount = {
            ap_id: 'https://example.com/users/bar',
        };

        const mockAccountService = {
            getAccountByApId: vi.fn().mockImplementation((id) => {
                if (id === activity.actor) {
                    return actorAccount;
                }

                if (
                    typeof activity.object === 'object' &&
                    activity.object.attributedTo &&
                    id === activity.object.attributedTo
                ) {
                    return attributedAccount;
                }

                return null;
            }),
        } as unknown as AccountService;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await getPostAuthor(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result).toEqual(attributedAccount);
    });

    it('should return the correct author if the activity has attribution as an object', async () => {
        const activity = {
            actor: 'https://example.com/users/foo',
            object: {
                attributedTo: {
                    id: 'https://example.com/users/bar',
                },
            },
        } as unknown as Activity;

        const actorAccount = {
            ap_id: 'https://example.com/users/foo',
        };
        const attributedAccount = {
            ap_id: 'https://example.com/users/bar',
        };

        const mockAccountService = {
            getAccountByApId: vi.fn().mockImplementation((id) => {
                if (id === activity.actor) {
                    return actorAccount;
                }

                if (
                    typeof activity.object === 'object' &&
                    activity.object.attributedTo &&
                    id === activity.object.attributedTo.id
                ) {
                    return attributedAccount;
                }

                return null;
            }),
        } as unknown as AccountService;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await getPostAuthor(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result).toEqual(attributedAccount);
    });
});

describe('getPostAuthorWithoutAttribution', () => {
    it('should return the correct author if the activity actor is a string', async () => {
        const activity = {
            actor: 'https://example.com/users/foo',
        } as unknown as Activity;

        const expectedAccount = {
            ap_id: 'https://example.com/users/foo',
        };

        const mockAccountService = {
            getAccountByApId: vi.fn().mockImplementation((id) => {
                if (id === activity.actor) {
                    return expectedAccount;
                }

                return null;
            }),
        } as unknown as AccountService;

        const result = await getPostAuthorWithoutAttribution(
            activity,
            mockAccountService,
        );

        expect(result).toEqual(expectedAccount);
    });

    it('should return the correct author if the activity actor is an object', async () => {
        const activity = {
            actor: {
                id: 'https://example.com/users/foo',
            },
        } as unknown as Activity;

        const expectedAccount = {
            ap_id: 'https://example.com/users/foo',
        };

        const mockAccountService = {
            getAccountByApId: vi.fn().mockImplementation((id) => {
                if (id === activity.actor.id) {
                    return expectedAccount;
                }

                return null;
            }),
        } as unknown as AccountService;

        const result = await getPostAuthorWithoutAttribution(
            activity,
            mockAccountService,
        );

        expect(result).toEqual(expectedAccount);
    });
});

describe('getPostExcerpt', () => {
    it('should return an empty string if the activity object is a note', async () => {
        const activity = {
            object: {
                content: 'foo bar baz',
                type: ACTIVITY_OBJECT_TYPE_NOTE,
            },
        } as unknown as Activity;

        const result = getPostExcerpt(activity);

        expect(result).toEqual('');
    });

    it('should return the preview content if the activity object has a preview', async () => {
        const activity = {
            object: {
                preview: {
                    content: 'foo bar baz',
                },
            },
        } as unknown as Activity;

        const result = getPostExcerpt(activity);

        expect(result).toEqual('foo bar baz');
    });

    it('should return the first 400 characters of the content if the activity object has no preview', async () => {
        const activity = {
            object: {
                content:
                    '<p>This is some content that contains HTML. <br> It contains multiple elements such as <a href="https://example.com">links</a>, <span>spans</span>, and other HTML tags. <br> This content is meant to be more than 400 characters long to test the excerpt functionality. <br> Here is some more text to ensure we exceed the 400 character limit. <br> Lorem ipsum dolor sit amet, consectetur adipiscing elit. <br> Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. <br> Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. <br> Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. <br> Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>',
            },
        } as unknown as Activity;

        const result = getPostExcerpt(activity);

        expect(result).toEqual(
            'This is some content that contains HTML. It contains multiple elements such as links , spans , and other HTML tags. This content is meant to be more than 400 characters long to test the excerpt functionality. Here is some more text to ensure we exceed the 400 character limit. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
        );
    });
});

describe('getPostFeatureImageUrl', () => {
    it('should return null if image is not present in the activity object', async () => {
        const activity = {
            object: {},
        } as unknown as Activity;

        const result = getPostFeatureImageUrl(activity);

        expect(result).toEqual(null);
    });

    it('should return the feature image URL if image is a string in the activity object', async () => {
        const activity = {
            object: {
                image: 'https://example.com/posts/123/image.jpg',
            },
        } as unknown as Activity;

        const result = getPostFeatureImageUrl(activity);

        expect(result).toEqual('https://example.com/posts/123/image.jpg');
    });

    it('should return the feature image URL if image is an object in the activity object', async () => {
        const activity = {
            object: {
                image: {
                    url: 'https://example.com/posts/123/image.jpg',
                },
            },
        } as unknown as Activity;

        const result = getPostFeatureImageUrl(activity);

        expect(result).toEqual('https://example.com/posts/123/image.jpg');
    });
});

describe('getPostContentReadingTimeMinutes', () => {
    it('should return 0 if the content is empty', async () => {
        const content = '';

        const result = getPostContentReadingTimeMinutes(content);

        expect(result).toEqual(0);
    });

    it('should return the correct reading time if the content is not empty', async () => {
        const shortContent =
            getPostContentReadingTimeMinutes('Lorem ipsum doller');

        expect(shortContent).toEqual(1);

        const longContent = getPostContentReadingTimeMinutes(`
<p>This is some content that contains HTML. <br> It contains multiple elements such as <a href="https://example.com">links</a>, <span>spans</span>, and other HTML tags. <br> This content is meant to be more than 400 characters long to test the excerpt functionality. <br> Here is some more text to ensure we exceed the 400 character limit. <br> Lorem ipsum dolor sit amet, consectetur adipiscing elit. <br> Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. <br> Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. <br> Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. <br> Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
<p>This is some content that contains HTML. <br> It contains multiple elements such as <a href="https://example.com">links</a>, <span>spans</span>, and other HTML tags. <br> This content is meant to be more than 400 characters long to test the excerpt functionality. <br> Here is some more text to ensure we exceed the 400 character limit. <br> Lorem ipsum dolor sit amet, consectetur adipiscing elit. <br> Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. <br> Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. <br> Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. <br> Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
<p>This is some content that contains HTML. <br> It contains multiple elements such as <a href="https://example.com">links</a>, <span>spans</span>, and other HTML tags. <br> This content is meant to be more than 400 characters long to test the excerpt functionality. <br> Here is some more text to ensure we exceed the 400 character limit. <br> Lorem ipsum dolor sit amet, consectetur adipiscing elit. <br> Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. <br> Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. <br> Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. <br> Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
`);

        expect(longContent).toEqual(2);
    });
});

describe('getPostAttachments', () => {
    it('should return an empty array if the activity object has no attachments', async () => {
        const activity = {
            object: {},
        } as unknown as Activity;

        const result = getPostAttachments(activity);

        expect(result).toEqual([]);
    });

    it('should return an array of attachments if the activity object has attachments', async () => {
        const activity = {
            object: {
                attachment: [
                    {
                        type: 'Image',
                        mediaType: 'image/jpeg',
                        name: 'test.jpg',
                        url: 'https://example.com/test.jpg',
                    },
                ],
            },
        } as unknown as Activity;

        const result = getPostAttachments(activity);

        expect(result).toEqual([
            {
                type: 'Image',
                mediaType: 'image/jpeg',
                name: 'test.jpg',
                url: 'https://example.com/test.jpg',
            },
        ]);
    });

    it('should return an array of attachments if the activity object has a single attachment that is not in an array', async () => {
        const activity = {
            object: {
                attachment: {
                    type: 'Image',
                    mediaType: 'image/jpeg',
                    name: 'test.jpg',
                    url: 'https://example.com/test.jpg',
                },
            },
        } as unknown as Activity;

        const result = getPostAttachments(activity);

        expect(result).toEqual([
            {
                type: 'Image',
                mediaType: 'image/jpeg',
                name: 'test.jpg',
                url: 'https://example.com/test.jpg',
            },
        ]);
    });
});

describe('mapActivityToPost', () => {
    const mockAuthor = {
        id: 123,
        ap_id: 'https://example.com/users/foobarbaz',
        username: 'foobarbaz',
        avatar_url: 'https://example.com/avatars/foobarbaz.jpg',
        name: 'Foo Bar Baz',
        url: 'https://example.com/users/foobarbaz',
    };

    const mockAccountService = {
        getAccountByApId: vi.fn().mockResolvedValue(mockAuthor),
    } as unknown as AccountService;

    it('should correctly map an activity containing an article to a post', async () => {
        const activity = {
            actor: 'https://example.com/users/foobarbaz',
            object: {
                id: 'https://example.com/posts/123',
                type: ACTIVITY_OBJECT_TYPE_ARTICLE,
                name: 'Test Article',
                content: '<p>Test content</p>',
                url: 'https://example.com/posts/123',
                published: '2024-01-01T00:00:00Z',
                liked: true,
                replyCount: 5,
                attachment: [
                    {
                        type: 'Image',
                        mediaType: 'image/jpeg',
                        name: 'test.jpg',
                        url: 'https://example.com/test.jpg',
                    },
                ],
            },
        } as unknown as Activity;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await mapActivityToPost(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result).toEqual({
            id: 'https://example.com/posts/123',
            type: PostType.Article,
            title: 'Test Article',
            excerpt: 'Test content',
            content: '<p>Test content</p>',
            url: 'https://example.com/posts/123',
            featureImageUrl: null,
            publishedAt: '2024-01-01T00:00:00Z',
            likeCount: 1,
            likedByMe: true,
            replyCount: 5,
            readingTimeMinutes: 1,
            attachments: [
                {
                    type: 'Image',
                    mediaType: 'image/jpeg',
                    name: 'test.jpg',
                    url: 'https://example.com/test.jpg',
                },
            ],
            author: {
                id: '123',
                handle: '@foobarbaz@example.com',
                avatarUrl: 'https://example.com/avatars/foobarbaz.jpg',
                name: 'Foo Bar Baz',
                url: 'https://example.com/users/foobarbaz',
            },
            repostedBy: null,
            repostCount: 0,
            repostedByMe: false,
        });
    });

    it('should correctly map an activity containing a note to a post', async () => {
        const activity = {
            actor: 'https://example.com/users/foobarbaz',
            object: {
                id: 'https://example.com/posts/123',
                type: ACTIVITY_OBJECT_TYPE_NOTE,
                content: '<p>Test note</p>',
                url: 'https://example.com/posts/123',
                published: '2024-01-01T00:00:00Z',
            },
        } as unknown as Activity;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await mapActivityToPost(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result).toEqual({
            id: 'https://example.com/posts/123',
            type: PostType.Note,
            title: '',
            excerpt: '',
            content: '<p>Test note</p>',
            url: 'https://example.com/posts/123',
            featureImageUrl: null,
            publishedAt: '2024-01-01T00:00:00Z',
            likeCount: 0,
            likedByMe: false,
            replyCount: 0,
            readingTimeMinutes: 1,
            attachments: [],
            author: {
                id: '123',
                handle: '@foobarbaz@example.com',
                avatarUrl: 'https://example.com/avatars/foobarbaz.jpg',
                name: 'Foo Bar Baz',
                url: 'https://example.com/users/foobarbaz',
            },
            repostedBy: null,
            repostCount: 0,
            repostedByMe: false,
        });
    });

    it('should handle missing content', async () => {
        const activity = {
            actor: 'https://example.com/users/foobarbaz',
            object: {
                id: 'https://example.com/posts/123',
                type: ACTIVITY_OBJECT_TYPE_NOTE,
                url: 'https://example.com/posts/123',
                published: '2024-01-01T00:00:00Z',
            },
        } as unknown as Activity;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await mapActivityToPost(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result?.content).toBe('');
        expect(result?.readingTimeMinutes).toBe(0);
    });

    it('should return null if an account for the author cannot be found', async () => {
        const mockAccountServiceNoAuthor = {
            getAccountByApId: vi.fn().mockResolvedValue(null),
        } as unknown as AccountService;

        const activity = {
            actor: 'https://example.com/users/foobarbaz',
            object: {
                id: 'https://example.com/posts/123',
                type: ACTIVITY_OBJECT_TYPE_NOTE,
                content: 'Test',
            },
        } as unknown as Activity;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await mapActivityToPost(
            activity,
            mockAccountServiceNoAuthor,
            fedifyCtx,
        );

        expect(result).toBeNull();
    });

    it('should set the repostedBy property if the activity is an announce', async () => {
        const activity = {
            actor: 'https://example.com/users/bazbarqux',
            type: ACTIVITY_TYPE_ANNOUNCE,
            object: {
                id: 'https://example.com/posts/123',
                type: ACTIVITY_TYPE_ANNOUNCE,
                content: 'Test',
                attributedTo: 'https://example.com/users/foobarbaz',
            },
        } as unknown as Activity;

        const mockReposter = {
            id: 456,
            ap_id: 'https://example.com/users/bazbarqux',
            username: 'bazbarqux',
            avatar_url: 'https://example.com/avatars/bazbarqux.jpg',
            name: 'Baz Bar Qux',
            url: 'https://example.com/users/bazbarqux',
        };

        const mockAccountService = {
            getAccountByApId: vi.fn().mockImplementation((id) => {
                if (id === activity.actor) {
                    return mockReposter;
                }

                return mockAuthor;
            }),
        } as unknown as AccountService;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await mapActivityToPost(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result?.repostedBy).toEqual({
            id: '456',
            handle: '@bazbarqux@example.com',
            avatarUrl: 'https://example.com/avatars/bazbarqux.jpg',
            name: 'Baz Bar Qux',
            url: 'https://example.com/users/bazbarqux',
        });
    });

    it('should use the published date of the announce if the activity is an announce', async () => {
        const activity = {
            actor: 'https://example.com/users/foobarbaz',
            type: ACTIVITY_TYPE_ANNOUNCE,
            object: {
                id: 'https://example.com/posts/123',
                type: ACTIVITY_OBJECT_TYPE_NOTE,
                published: '2024-01-01T00:00:00Z',
            },
            published: '2024-02-02T00:00:00Z',
        } as unknown as Activity;

        const fedifyCtx = {} as FedifyRequestContext;

        const result = await mapActivityToPost(
            activity,
            mockAccountService,
            fedifyCtx,
        );

        expect(result?.publishedAt).toEqual('2024-02-02T00:00:00Z');
    });
});
