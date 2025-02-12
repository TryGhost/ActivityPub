import { afterAll, describe, it } from 'vitest';

import assert from 'node:assert';
import EventEmitter from 'node:events';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { client } from '../db';
import { SiteService } from '../site/site.service';
import { Post } from './post.entity';
import { KnexPostRepository } from './post.repository.knex';

afterAll(async () => {
    await client.destroy();
});

describe('KnexPostRepository', () => {
    it('Can save a Post', async () => {
        const events = new EventEmitter();
        const accountService = new AccountService(client, events);
        const siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });
        const accountRepository = new KnexAccountRepository(client, events);
        const postRepository = new KnexPostRepository(client, events);

        const site = await siteService.initialiseSiteForHost('testing.com');

        const account = await accountRepository.getBySite(site);

        const post = Post.createArticleFromGhostPost(account, {
            title: 'Title',
            html: '<p>Hello, world!</p>',
            excerpt: 'Hello, world!',
            feature_image: null,
            url: 'https://testing.com/hello-world',
            published_at: '2025-01-01',
        });

        await postRepository.save(post);

        const rowInDb = await client('posts')
            .where({
                uuid: post.uuid,
            })
            .select('*')
            .first();

        assert(rowInDb, 'A row should have been saved in the DB');
    });
});
