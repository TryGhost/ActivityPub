import { exportJwk, generateCryptoKeyPair } from '@fedify/fedify';
import type { Knex } from 'knex';

import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY,
    AP_BASE_PATH,
    TABLE_ACCOUNTS,
    TABLE_FOLLOWS,
    TABLE_USERS,
} from '../constants';
import type { Account, ExternalAccountData, Site } from './types';

interface GetFollowedAccountsOptions {
    limit: number;
    offset: number;
    fields: (keyof Account)[];
}

export class AccountService {
    /**
     * @param db Database client
     */
    constructor(private readonly db: Knex) {}

    /**
     * Create an internal account
     *
     * An internal account is an account that is linked to a user
     *
     * @param site Site that the account belongs to
     * @param username Username for the account
     */
    async createInternalAccount(
        site: Site,
        username: string,
    ): Promise<Account> {
        const keyPair = await generateCryptoKeyPair();

        const accountData = {
            name: ACTOR_DEFAULT_NAME,
            username,
            bio: ACTOR_DEFAULT_SUMMARY,
            avatar_url: ACTOR_DEFAULT_ICON,
            banner_image_url: null,
            url: `https://${site.host}`,
            custom_fields: null,
            ap_id: `https://${site.host}${AP_BASE_PATH}/users/${username}`,
            ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
            ap_shared_inbox_url: null,
            ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
            ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
            ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
            ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
            ap_public_key: JSON.stringify(await exportJwk(keyPair.publicKey)),
            ap_private_key: JSON.stringify(await exportJwk(keyPair.privateKey)),
        };

        return await this.db.transaction(async (tx) => {
            const [accountId] = await tx(TABLE_ACCOUNTS).insert(accountData);

            await tx(TABLE_USERS).insert({
                account_id: accountId,
                site_id: site.id,
            });

            return {
                id: accountId,
                ...accountData,
            };
        });
    }

    /**
     * Create an external account
     *
     * An external account is an account that is not linked to a user
     *
     * @param accountData Data for the external account
     */
    async createExternalAccount(
        accountData: ExternalAccountData,
    ): Promise<Account> {
        const [accountId] = await this.db(TABLE_ACCOUNTS).insert(accountData);

        return {
            id: accountId,
            ...accountData,
            ap_private_key: null,
        };
    }

    /**
     * Record an account follow
     *
     * @param followee Account to follow
     * @param follower Following account
     */
    async recordAccountFollow(
        followee: Account,
        follower: Account,
    ): Promise<void> {
        await this.db(TABLE_FOLLOWS)
            .insert({
                following_id: followee.id,
                follower_id: follower.id,
            })
            .onConflict(['following_id', 'follower_id'])
            .ignore();
    }

    /**
     * Get an account by it's ActivityPub ID
     *
     * @param apId ActivityPub ID
     */
    async getAccountByApId(apId: string): Promise<Account | null> {
        if (apId === '') {
            return null;
        }

        return await this.db(TABLE_ACCOUNTS).where('ap_id', apId).first();
    }

    /**
     * Get the default account for a site
     *
     * @param site Site
     */
    async getDefaultAccountForSite(site: Site): Promise<Account | null> {
        const users = await this.db(TABLE_USERS).where('site_id', site.id);

        if (users.length === 0) {
            throw new Error(`No user found for site: ${site.id}`);
        }

        if (users.length > 1) {
            throw new Error(`Multiple users found for site: ${site.id}`);
        }

        const user = users[0];

        // We can safely assume that there is an account for the user due to
        // the foreign key constraint on the users table
        return await this.db(TABLE_ACCOUNTS)
            .where('id', user.account_id)
            .first();
    }

    /**
     * Get the accounts that the provided account is following
     *
     * The results are ordered in reverse chronological order
     *
     * @param account Account
     * @param options Options for the query
     */
    async getFollowedAccounts(
        account: Account,
        options: GetFollowedAccountsOptions, // @TODO: Make this optional
    ): Promise<Account[]> {
        return await this.db(TABLE_FOLLOWS)
            .select(options.fields.map((field) => `${TABLE_ACCOUNTS}.${field}`))
            .where(`${TABLE_FOLLOWS}.follower_id`, account.id)
            .innerJoin(
                TABLE_ACCOUNTS,
                `${TABLE_ACCOUNTS}.id`,
                `${TABLE_FOLLOWS}.following_id`,
            )
            .limit(options.limit)
            .offset(options.offset)
            // order by the date created at in descending order and then by the
            // account id in descending order to ensure the most recent follows
            // are returned first (i.e in case multiple follows were created at
            // the same time)
            // @TODO: Make this configurable via the options?
            .orderBy(`${TABLE_FOLLOWS}.created_at`, 'desc')
            .orderBy(`${TABLE_ACCOUNTS}.id`, 'desc');
    }

    async getByInternalId(id: number): Promise<Account | null> {
        const rows = await this.db(TABLE_ACCOUNTS).select('*').where({ id });

        if (!rows || !rows.length) {
            return null;
        }

        if (rows.length !== 1) {
            throw new Error(`Multiple accounts found for id ${id}`);
        }

        const row = rows[0];

        return {
            id: row.id,
            username: row.username,
            name: row.name,
            bio: row.bio,
            avatar_url: row.avatar_url,
            banner_image_url: row.banner_image_url,
            url: row.url,
            custom_fields: JSON.parse(row.custom_fields),
            ap_id: row.ap_id,
            ap_inbox_url: row.ap_inbox_url,
            ap_shared_inbox_url: row.ap_shared_inbox_url,
            ap_outbox_url: row.ap_outbox_url,
            ap_following_url: row.ap_following_url,
            ap_followers_url: row.ap_followers_url,
            ap_liked_url: row.ap_liked_url,
            ap_public_key: row.ap_public_key,
            ap_private_key: row.ap_private_key,
        };
    }
}
