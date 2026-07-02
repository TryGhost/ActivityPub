import { describe, expect, it } from 'vitest';

import { postToDTO } from '@/http/api/helpers/post';
import { Post, PostType } from '@/post/post.entity';
import {
    createTestExternalAccount,
    createTestInternalAccount,
} from '@/test/account-entity-test-helpers';

function createAuthor() {
    return createTestInternalAccount(123, {
        host: new URL('http://foobar.com'),
        username: 'foobar',
        name: 'Foo Bar',
        bio: 'Just a foobar',
        url: null,
        avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
        bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
        customFields: null,
    });
}

function createExternalAuthor() {
    return createTestExternalAccount(456, {
        username: 'remote',
        name: 'Remote Author',
        bio: null,
        url: new URL('https://remote.example.com/@remote'),
        avatarUrl: null,
        bannerImageUrl: null,
        customFields: null,
        apId: new URL('https://remote.example.com/users/remote'),
        apFollowers: new URL(
            'https://remote.example.com/users/remote/followers',
        ),
        apInbox: new URL('https://remote.example.com/users/remote/inbox'),
    });
}

describe('postToPostDTO', () => {
    it('Should use apIds as the id', async () => {
        const author = await createAuthor();
        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.id).toEqual(post.apId.href);
        expect(dto.author.id).toEqual(post.author.apId.href);
    });

    it('Should default title, excerpt and content to empty strings', async () => {
        const author = await createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
        });

        const dto = postToDTO(post);

        expect(dto.title).toEqual('');
        expect(dto.excerpt).toEqual('');
        expect(dto.content).toEqual('');
    });

    it('should default to a metadata object with an empty ghostAuthors array', async () => {
        const author = await createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.metadata).toEqual({ ghostAuthors: [] });
    });

    it('Should include summary in the DTO', async () => {
        const author = await createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Article,
            title: 'Test Article',
            excerpt: 'Test excerpt',
            summary: 'Test summary',
            content: 'Test content',
        });

        const dto = postToDTO(post);

        expect(dto.title).toEqual('Test Article');
        expect(dto.excerpt).toEqual('Test excerpt');
        expect(dto.summary).toEqual('Test summary');
        expect(dto.content).toEqual('Test content');
    });

    it('should sanitize HTML in title values', async () => {
        const author = await createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Article,
            title: 'Hello <script>alert("xss")</script><strong>world</strong>',
            content: 'Test content',
        });

        const dto = postToDTO(post);

        expect(dto.title).toContain('Hello');
        expect(dto.title).toContain('world');
        expect(dto.title).not.toContain('<script');
        expect(dto.title).not.toContain('alert("xss")');
    });

    it('Should default summary to null', async () => {
        const author = await createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.summary).toBeNull();
    });

    it('should expose sensitive posts in the DTO', async () => {
        const author = await createExternalAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
            sensitive: true,
            apId: new URL('https://remote.example.com/posts/sensitive'),
        });

        const dto = postToDTO(post);

        expect(dto.sensitive).toBe(true);
        expect(dto.contentWarning).toBeNull();
    });

    it('should expose a content warning for remote sensitive posts with a summary', async () => {
        const author = await createExternalAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
            summary: 'Sensitive topic',
            sensitive: true,
            apId: new URL('https://remote.example.com/posts/content-warning'),
        });

        const dto = postToDTO(post);

        expect(dto.sensitive).toBe(true);
        expect(dto.summary).toBe('Sensitive topic');
        expect(dto.contentWarning).toBe('Sensitive topic');
    });

    it('should trim whitespace around content warnings', async () => {
        const author = await createExternalAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
            summary: '  Sensitive topic  ',
            sensitive: true,
            apId: new URL('https://remote.example.com/posts/padded-warning'),
        });

        const dto = postToDTO(post);

        expect(dto.sensitive).toBe(true);
        expect(dto.summary).toBe('Sensitive topic');
        expect(dto.contentWarning).toBe('Sensitive topic');
    });

    it('should not treat internal Ghost post summaries as content warnings', async () => {
        const author = await createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Article,
            content: 'Hello, world!',
            summary: 'Custom excerpt',
            sensitive: true,
        });

        const dto = postToDTO(post);

        expect(dto.sensitive).toBe(true);
        expect(dto.summary).toBe('Custom excerpt');
        expect(dto.contentWarning).toBeNull();
    });
});
