import { describe, expect, it } from 'vitest';

import { postToDTO } from '@/http/api/helpers/post';
import { Post, PostType } from '@/post/post.entity';
import { createTestInternalAccount } from '@/test/account-entity-test-helpers';

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

    it('Should default summary to null', async () => {
        const author = await createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.summary).toBeNull();
    });
});
