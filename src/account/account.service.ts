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

        return (
            (await this.db(TABLE_ACCOUNTS).where('ap_id', apId).first()) ?? null
        );
    }
}
