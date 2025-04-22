import { faker } from '@faker-js/faker';
import type { Knex } from 'knex';

import type { Account } from 'account/account.entity';
import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { AsyncEvents } from 'core/events';
import { type CreatePostType, Post, PostType } from 'post/post.entity';
import { KnexPostRepository } from 'post/post.repository.knex';
import { type Site, SiteService } from 'site/site.service';
import { generateTestCryptoKeyPair } from './crypto-key-pair';

export class FixtureManager {
    constructor(
        private readonly db: Knex,
        private readonly accountRepository: KnexAccountRepository,
        private readonly accountService: AccountService,
        private readonly siteService: SiteService,
        private readonly postRepository: KnexPostRepository,
    ) {}

    async createInternalAccount(
        site?: Site | null,
        host = faker.internet.domainName(),
    ) {
        let _site: Site;
        let _account: Account;

        if (!site) {
            _site = await this.siteService.initialiseSiteForHost(host);
            _account = await this.accountService.getAccountForSite(_site);
        } else {
            _site = site;

            const { ap_id: accountApId } =
                await this.accountService.createInternalAccount(_site, {
                    username: faker.internet.username(),
                    name: faker.person.fullName(),
                    bio: faker.lorem.sentence(),
                    avatar_url: faker.image.url(),
                });

            const accountByApId = await this.accountRepository.getByApId(
                new URL(accountApId),
            );

            if (!accountByApId) {
                throw new Error(
                    `Account not found with ap_id ${accountApId} for site ${_site.id}`,
                );
            }

            _account = accountByApId;
        }

        return {
            site: _site,
            account: _account,
        };
    }

    async createPost(
        account: Account,
        {
            type = PostType.Note,
        }: {
            type?: CreatePostType;
        } = {},
    ) {
        const post = Post.createFromData(account, {
            type,
            content:
                type === PostType.Article
                    ? faker.lorem.paragraph()
                    : faker.lorem.sentence(),
            title: type === PostType.Article ? faker.lorem.sentence() : null,
        });

        await this.postRepository.save(post);

        return post;
    }

    async createBlock(blocker: Account, blocked: Account) {
        await this.db('blocks').insert({
            blocker_id: blocker.id,
            blocked_id: blocked.id,
        });
    }

    async reset() {
        await this.db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await this.db('blocks').truncate();
        await this.db('posts').truncate();
        await this.db('accounts').truncate();
        await this.db('users').truncate();
        await this.db('sites').truncate();
        await this.db.raw('SET FOREIGN_KEY_CHECKS = 1');
    }
}

export function createFixtureManager(
    db: Knex,
    events: AsyncEvents = new AsyncEvents(),
) {
    const accountRepository = new KnexAccountRepository(db, events);
    const fedifyContextFactory = new FedifyContextFactory();
    const accountService = new AccountService(
        db,
        events,
        accountRepository,
        fedifyContextFactory,
        generateTestCryptoKeyPair,
    );
    const siteService = new SiteService(db, accountService, {
        getSiteSettings: async () => ({
            site: {
                description: faker.lorem.sentence(),
                title: faker.lorem.sentence(),
                icon: faker.image.url(),
            },
        }),
    });
    const postRepository = new KnexPostRepository(db, events);

    return new FixtureManager(
        db,
        accountRepository,
        accountService,
        siteService,
        postRepository,
    );
}
