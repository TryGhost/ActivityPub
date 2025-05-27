import { describe, expect, it } from 'vitest';

import { AccountEntity } from 'account/account.entity';
import { Post, PostType } from 'post/post.entity';
import { postToDTO } from './post';

function createAuthor() {
    const draft = AccountEntity.draft({
        isInternal: true,
        host: new URL('http://foobar.com'),
        username: 'foobar',
        name: 'Foo Bar',
        bio: 'Just a foobar',
        url: null,
        avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
        bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
    });

    return AccountEntity.create({
        id: 123,
        ...draft,
    });
}

describe('postToPostDTO', () => {
    it('Should use apIds as the id', () => {
        const author = createAuthor();
        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.id).toEqual(post.apId.href);
        expect(dto.author.id).toEqual(post.author.apId.href);
    });

    it('Should default title, excerpt and content to empty strings', () => {
        const author = createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
        });

        const dto = postToDTO(post);

        expect(dto.title).toEqual('');
        expect(dto.excerpt).toEqual('');
        expect(dto.content).toEqual('');
    });

    it('should default to a metadata object with an empty ghostAuthors array', () => {
        const author = createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.metadata).toEqual({ ghostAuthors: [] });
    });

    it('Should include summary in the DTO', () => {
        const author = createAuthor();

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

    it('Should default summary to null', () => {
        const author = createAuthor();

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.summary).toBeNull();
    });
});
