import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AsyncEvents } from '@/core/events';
import { getError, getValue, isError } from '@/core/result';
import { HostDataContextLoader } from '@/http/host-data-context-loader';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('HostDataContextLoader', () => {
    let loader: HostDataContextLoader;
    let db: Knex;
    let fixtureManager: FixtureManager;

    beforeAll(async () => {
        db = await createTestDb();
    });

    beforeEach(async () => {
        fixtureManager = createFixtureManager(db);

        await fixtureManager.reset();

        const accountRepository = new KnexAccountRepository(
            db,
            new AsyncEvents(),
        );

        loader = new HostDataContextLoader(db, accountRepository);
    });

    it('should return site and account associated with the provided host', async () => {
        const host = 'example.com';

        const [account, site] = await fixtureManager.createInternalAccount(
            null,
            host,
        );

        const result = await loader.loadDataForHost(host);

        if (isError(result)) {
            throw new Error('Expected result to be not an error');
        }

        const { site: loadedSite, account: loadedAccount } = getValue(result);

        // Verify site data
        expect(loadedSite.id).toBe(site.id);
        expect(loadedSite.host).toBe(site.host);
        expect(loadedSite.webhook_secret).toBe(site.webhook_secret);

        // Verify account data
        expect(loadedAccount.id).toBe(account.id);
        expect(loadedAccount.uuid).toBe(account.uuid);
        expect(loadedAccount.username).toBe(account.username);
        expect(loadedAccount.name).toBe(account.name);
        expect(loadedAccount.bio).toBe(account.bio);
        expect(loadedAccount.url.href).toBe(account.url.href);
        expect(loadedAccount.apId.href).toBe(account.apId.href);
        expect(loadedAccount.apFollowers?.href).toBe(account.apFollowers?.href);
        expect(loadedAccount.apInbox?.href).toBe(account.apInbox?.href);
    });

    it('should return a "site-not-found" error when the site associated with the host does not exist in the database', async () => {
        const host = 'example.com';

        const result = await loader.loadDataForHost(host);

        expect(isError(result)).toBe(true);

        if (!isError(result)) {
            throw new Error('Expected result to be an error');
        }

        const error = getError(result);

        expect(error).toBe('site-not-found');
    });

    it('should return a "account-not-found" error when the site exists but has no associated user/account', async () => {
        const host = 'example.com';

        await fixtureManager.createSite(host);

        const result = await loader.loadDataForHost(host);

        expect(isError(result)).toBe(true);

        if (!isError(result)) {
            throw new Error('Expected result to be an error');
        }

        const error = getError(result);

        expect(error).toBe('account-not-found');
    });

    it('should return a "multiple-users-for-site" error when the site has multiple associated users', async () => {
        const host = 'example.com';

        const site = await fixtureManager.createSite(host);

        await fixtureManager.createInternalAccount(site, host);

        // Create second account manually
        const [secondAccountId] = await db('accounts').insert({
            uuid: 'f1234567-1829-4c27-8517-93a2f57045a2',
            username: 'testuser2',
            name: 'Test User 2',
            bio: null,
            url: `https://${host}`,
            avatar_url: null,
            banner_image_url: null,
            ap_id: `https://${host}/activitypub/actor/testuser2`,
            ap_followers_url: `https://${host}/activitypub/actor/testuser2/followers`,
            ap_inbox_url: `https://${host}/activitypub/actor/testuser2/inbox`,
            custom_fields: null,
            domain: host,
        });

        // Link second account to the same site via the users table
        await db('users').insert({
            site_id: site.id,
            account_id: secondAccountId,
        });

        const result = await loader.loadDataForHost(host);

        expect(isError(result)).toBe(true);

        if (!isError(result)) {
            throw new Error('Expected result to be an error');
        }

        const error = getError(result);

        expect(error).toBe('multiple-users-for-site');
    });
});
