import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import { NodeInfoService } from '@/activitypub/nodeinfo.service';
import { AsyncEvents } from '@/core/events';
import { KnexKvStore } from '@/knex.kvstore';
import { PostType } from '@/post/post.entity';
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

        const nodeInfo = await service.getNodeInfo(site, account);

        expect(nodeInfo.usage.localPosts).toBe(2);
        expect(nodeInfo.usage.localComments).toBe(0);
    });
});
