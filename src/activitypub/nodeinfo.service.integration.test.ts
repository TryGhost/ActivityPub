import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import { NodeInfoService } from '@/activitypub/nodeinfo.service';
import { AsyncEvents } from '@/core/events';
import { KnexKvStore } from '@/knex.kvstore';
import { OutboxType, PostType } from '@/post/post.entity';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('NodeInfoService integration', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;

    const logger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
    } as unknown as Logger;

    beforeAll(async () => {
        db = await createTestDb();
    });

    beforeEach(async () => {
        fixtureManager = createFixtureManager(db);
        await fixtureManager.reset();
        await db('key_value').delete();
    });

    it('computes local posts and comments from outboxes', async () => {
        const [account, site] = await fixtureManager.createInternalAccount();
        const article = await fixtureManager.createPost(account, {
            type: PostType.Article,
        });
        await fixtureManager.createPost(account);
        const reply = await fixtureManager.createReply(account, article);

        reply.delete(account);
        const postRepository = new KnexPostRepository(
            db,
            new AsyncEvents(),
            logger,
        );
        await postRepository.save(reply);

        const service = new NodeInfoService(
            db,
            KnexKvStore.create(db, 'key_value', logger),
            logger,
        );

        const data = await service.getData(site, account);

        expect(data.localPosts).toBe(2);
        expect(data.localComments).toBe(0);
    });

    it('uses the latest retained activity from each supported source', async () => {
        const [account, site] = await fixtureManager.createInternalAccount();
        const [followedAccount] = await fixtureManager.createInternalAccount();
        const article = await fixtureManager.createPost(account, {
            type: PostType.Article,
        });
        const reply = await fixtureManager.createReply(account, article);
        const baseDate = new Date('2026-01-01T00:00:00.000Z');
        const latestDate = new Date('2026-02-01T00:00:00.000Z');

        await db('outboxes')
            .insert({
                account_id: account.id,
                author_id: account.id,
                outbox_type: OutboxType.Repost,
                post_id: article.id,
                post_type: PostType.Article,
                published_at: baseDate,
            })
            .onConflict(['account_id', 'post_id', 'outbox_type'])
            .ignore();

        await db('likes').insert({
            account_id: account.id,
            post_id: article.id,
            created_at: baseDate,
        });

        await db('follows').insert({
            follower_id: account.id,
            following_id: followedAccount.id,
            created_at: baseDate,
        });

        const service = new NodeInfoService(
            db,
            KnexKvStore.create(db, 'key_value', logger),
            logger,
        );

        type ActivitySource =
            | 'original'
            | 'repost'
            | 'reply'
            | 'like'
            | 'follow';

        for (const latestSource of [
            'original',
            'repost',
            'reply',
            'like',
            'follow',
        ] satisfies ActivitySource[]) {
            const dateFor = (source: ActivitySource) =>
                source === latestSource ? latestDate : baseDate;

            await db('outboxes')
                .where({
                    account_id: account.id,
                    outbox_type: OutboxType.Original,
                    post_id: article.id,
                })
                .update({ published_at: dateFor('original') });

            await db('outboxes')
                .where({
                    account_id: account.id,
                    outbox_type: OutboxType.Repost,
                    post_id: article.id,
                })
                .update({ published_at: dateFor('repost') });

            await db('outboxes')
                .where({
                    account_id: account.id,
                    outbox_type: OutboxType.Reply,
                    post_id: reply.id,
                })
                .update({ published_at: dateFor('reply') });

            await db('likes')
                .where({
                    account_id: account.id,
                    post_id: article.id,
                })
                .update({ created_at: dateFor('like') });

            await db('follows')
                .where({
                    follower_id: account.id,
                    following_id: followedAccount.id,
                })
                .update({ created_at: dateFor('follow') });

            await db('key_value').delete();

            const data = await service.getData(site, account);

            expect(data.lastActivityAt?.toISOString()).toBe(
                latestDate.toISOString(),
            );
        }
    });
});
