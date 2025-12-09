import crypto from 'node:crypto';

import { faker } from '@faker-js/faker';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { AsyncEvents } from '@/core/events';
import type { NotificationType } from '@/notification/notification.service';
import { type CreatePostType, Post, PostType } from '@/post/post.entity';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { type Site, SiteService } from '@/site/site.service';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';

export class FixtureManager {
    constructor(
        private readonly db: Knex,
        private readonly accountRepository: KnexAccountRepository,
        private readonly accountService: AccountService,
        private readonly siteService: SiteService,
        private readonly postRepository: KnexPostRepository,
    ) {}

    async createSite(host = faker.internet.domainName()): Promise<Site> {
        const webhook_secret = crypto.randomBytes(32).toString('hex');
        const ghost_uuid = crypto.randomUUID();

        const [id] = await this.db
            .insert({
                host,
                webhook_secret,
                ghost_uuid,
            })
            .into('sites');

        return {
            id,
            host,
            webhook_secret,
            ghost_uuid,
        };
    }

    async createInternalAccount(
        site?: Site | null,
        host = faker.internet.domainName(),
    ): Promise<[Account, Site, number]> {
        let _site: Site;
        let _account: Account;

        if (!site) {
            _site = await this.siteService.initialiseSiteForHost(host);
            _account = await this.accountService.getAccountForSite(_site);
        } else {
            _site = site;

            const { ap_id: accountApId } =
                await this.accountService.createInternalAccount(_site, {
                    username: faker.internet.username().replace('.', '_'),
                    name: faker.person.fullName(),
                    bio: null,
                    avatar_url: null,
                    banner_image_url: null,
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

        const user = await this.db('users')
            .select('id')
            .where('account_id', _account.id)
            .first();

        if (!user) {
            throw new Error(`User not found for account ${_account.id}`);
        }

        return [_account, _site, user.id];
    }

    async createExternalAccount(
        url = faker.internet.url({ appendSlash: true }),
    ) {
        const username = faker.internet.username().replace('.', '_');

        const createdAccount = await this.accountService.createExternalAccount({
            username,
            name: null,
            bio: null,
            avatar_url: null,
            banner_image_url: null,
            url: null,
            custom_fields: null,
            ap_id: `${url}${username}`,
            ap_inbox_url: `${url}${username}/inbox`,
            ap_shared_inbox_url: `${url}inbox`,
            ap_outbox_url: `${url}${username}/outbox`,
            ap_following_url: `${url}${username}/following`,
            ap_followers_url: `${url}${username}/followers`,
            ap_liked_url: `${url}${username}/liked`,
            ap_public_key: 'abc123',
        });

        const account = await this.accountRepository.getByApId(
            new URL(createdAccount.ap_id),
        );

        if (!account) {
            throw new Error(
                `Account not found with ap_id ${createdAccount.ap_id}`,
            );
        }

        return account;
    }

    async createPost(
        account: Account,
        {
            type = PostType.Note,
            inReplyTo,
        }: {
            type?: CreatePostType;
            inReplyTo?: Post;
        } = {},
    ) {
        let apId = null;
        if (!account.isInternal) {
            apId = new URL(`/post/${faker.string.uuid()}`, account.apId);
        }

        const post = Post.createFromData(account, {
            apId: apId ?? undefined,
            type,
            inReplyTo,
            content:
                type === PostType.Article
                    ? faker.lorem.paragraph()
                    : faker.lorem.sentence(),
            title: type === PostType.Article ? faker.lorem.sentence() : null,
        });

        await this.postRepository.save(post);

        return post;
    }

    async createReply(account: Account, inReplyTo: Post) {
        const reply = await this.createPost(account, {
            type: PostType.Note,
            inReplyTo,
        });

        return reply;
    }

    async createBlock(blocker: Account, blocked: Account) {
        await this.db('blocks').insert({
            blocker_id: blocker.id,
            blocked_id: blocked.id,
        });
    }

    async createDomainBlock(blocker: Account, domain: URL) {
        await this.db('domain_blocks').insert({
            blocker_id: blocker.id,
            domain: domain.hostname,
        });
    }

    async createFollow(follower: Account, following: Account) {
        await this.db('follows').insert({
            follower_id: follower.id,
            following_id: following.id,
        });
    }

    async createNotification(
        userAccount: Account,
        fromAccount: Account,
        type: NotificationType,
        postId?: number | null,
        inReplyToPostId?: number | null,
    ) {
        const user = await this.db('users')
            .select('id')
            .where('account_id', userAccount.id)
            .first();

        if (!user) {
            throw new Error(`User not found for account ${userAccount.id}`);
        }

        await this.db('notifications').insert({
            user_id: user.id,
            account_id: fromAccount.id,
            event_type: type,
            post_id: postId,
            in_reply_to_post_id: inReplyToPostId,
        });
    }

    async createMention(account: Account, post: Post) {
        return this.db('mentions').insert({
            account_id: account.id,
            post_id: post.id,
        });
    }

    async enableBlueskyIntegration(
        account: Account,
        confirmed: boolean = true,
        handle?: string | null,
    ) {
        const resolvedHandle =
            handle !== undefined
                ? handle
                : confirmed
                  ? `@${account.username}@bluesky`
                  : null;

        await this.db('bluesky_integration_account_handles').insert({
            account_id: account.id,
            handle: resolvedHandle,
            confirmed,
        });
    }

    async disableBlueskyIntegration(account: Account) {
        await this.db('bluesky_integration_account_handles')
            .where({
                account_id: account.id,
            })
            .delete();
    }

    async createTopic(name: string, slug: string, displayOrder: number = 0) {
        const [id] = await this.db('topics').insert({
            name,
            slug,
            display_order: displayOrder,
        });
        return { id, name, slug, displayOrder };
    }

    async addAccountToTopic(
        accountId: number,
        topicId: number,
        rank: number = 0,
    ) {
        await this.db('account_topics').insert({
            account_id: accountId,
            topic_id: topicId,
            rank_in_topic: rank,
        });
    }

    async reset() {
        await this.db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await Promise.all([
            this.db('notifications').truncate(),
            this.db('likes').truncate(),
            this.db('reposts').truncate(),
            this.db('posts').truncate(),
            this.db('domain_blocks').truncate(),
            this.db('blocks').truncate(),
            this.db('follows').truncate(),
            this.db('accounts').truncate(),
            this.db('users').truncate(),
            this.db('sites').truncate(),
            this.db('outboxes').truncate(),
            this.db('mentions').truncate(),
            this.db('bluesky_integration_account_handles').truncate(),
            this.db('account_topics').truncate(),
            this.db('topics').truncate(),
        ]);
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
        getSiteSettings: async (host) => ({
            site: {
                description: faker.lorem.sentence(),
                title: faker.person.fullName(),
                icon: `https://${host}/avatar/c4863565-3533-43fa-9991-19c5160a4da2.jpg`,
                cover_image: `https://${host}/cover/cd93c035-7326-4043-aed1-9150fe91b59.jpg`,
                site_uuid: crypto.randomUUID(),
            },
        }),
    });
    const logger = {
        info: () => {},
    } as unknown as Logger;
    const postRepository = new KnexPostRepository(db, events, logger);

    return new FixtureManager(
        db,
        accountRepository,
        accountService,
        siteService,
        postRepository,
    );
}
