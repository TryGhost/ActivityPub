import { describe, expect, it } from 'vitest';

import { Account } from 'account/account.entity';
import { Post, PostType } from 'post/post.entity';
import { postToDTO } from './post';

describe('postToPostDTO', () => {
    it('Should use apIds as the id', () => {
        const author = new Account(
            123,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            {
                id: 123,
                host: 'foobar.com',
                webhook_secret: 'secret',
            },
            new URL('https://foobar.com/user/123'),
            null,
        );

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const dto = postToDTO(post);

        expect(dto.id).toEqual(post.apId.href);
        expect(dto.author.id).toEqual(post.author.apId.href);
    });

    it('Should default title, excerpt and content to empty strings', () => {
        const author = new Account(
            123,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            {
                id: 123,
                host: 'foobar.com',
                webhook_secret: 'secret',
            },
            new URL('https://foobar.com/user/123'),
            null,
        );

        const post = Post.createFromData(author, {
            type: PostType.Note,
        });

        const dto = postToDTO(post);

        expect(dto.title).toEqual('');
        expect(dto.excerpt).toEqual('');
        expect(dto.content).toEqual('');
    });
});
