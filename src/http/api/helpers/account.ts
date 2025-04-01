import { type Context, isActor } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { Account as AccountType, Site } from 'account/types';
import { getAccountHandle } from 'account/utils';
import type { ContextData } from 'app';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    isFollowedByDefaultSiteAccount,
} from 'helpers/activitypub/actor';
import { sanitizeHtml } from 'helpers/html';
import { lookupObject } from 'lookup-helpers';
import { AP_BASE_PATH } from '../../../constants';
import type { AccountDTO } from '../types';

/**
 * Checks if an account is internal
 * @param account - The account to check
 *
 * @returns boolean indicating if the account is internal
 */
export function isInternalAccount(account: AccountType): boolean {
    return account.ap_id.toString().includes(AP_BASE_PATH);
}

/**
 * Converts an Account to an AccountDTO
 * @param account - The account to convert
 *
 * @returns Promise resolving to AccountDTO
 */
export async function getAccountDtoFromAccount(
    account: AccountType,
    defaultAccount: AccountType,
    accountService: AccountService,
): Promise<AccountDTO> {
    const accountDto: AccountDTO = {
        id: account.id.toString(),
        name: account.name || '',
        handle: getAccountHandle(new URL(account.ap_id).host, account.username),
        bio: sanitizeHtml(account.bio || ''),
        url: account.url || '',
        avatarUrl: account.avatar_url || '',
        /**
         * At the moment we don't support banner images for Ghost accounts
         */
        bannerImageUrl: account.banner_image_url || '',
        /**
         * At the moment we don't support custom fields for Ghost accounts
         */
        customFields: {},
        attachment: [],
        postCount: await accountService.getPostCount(account),
        likedCount: await accountService.getLikedCount(account),
        followingCount: await accountService.getFollowingAccountsCount(account),
        followerCount: await accountService.getFollowerAccountsCount(account),
        followedByMe: await accountService.checkIfAccountIsFollowing(
            defaultAccount,
            account,
        ),
        followsMe: false,
    };
    return accountDto;
}

/**
 * Retrieves an AccountDTO by looking up an actor using their handle
 * @param handle - The handle to look up (e.g., "@username@domain")
 *
 * @returns Promise resolving to AccountDTO
 */
export async function getAccountDTOByHandle(
    handle: string,
    apCtx: Context<ContextData>,
    site: Site,
    accountService: AccountService,
): Promise<AccountDTO> {
    if (!handle) {
        throw new Error('Handle is null');
    }

    // Lookup actor by handle
    const actorObj = await lookupObject(apCtx, handle);

    if (!isActor(actorObj)) {
        throw new Error('Actor not found');
    }

    const actor: any = await actorObj.toJsonLd();

    const [followerCount, followingCount, isFollowingResult, attachments] =
        await Promise.all([
            getFollowerCount(actorObj),
            getFollowingCount(actorObj),
            isFollowedByDefaultSiteAccount(actorObj, site, accountService),
            getAttachments(actorObj, {
                sanitizeValue: (value: string) => sanitizeHtml(value),
            }),
        ]);

    const accountDto: AccountDTO = {
        id: actor.id,
        name: actor.name || '',
        handle: getHandle(actorObj),
        bio: sanitizeHtml(actor.summary),
        url: actor.url || '',
        avatarUrl: actor.icon?.url || '',
        bannerImageUrl: actor.image?.url || '',
        customFields: {},
        postCount: 0,
        likedCount: 0,
        followingCount: followingCount,
        followerCount: followerCount,
        followedByMe: isFollowingResult,
        followsMe: false,
        attachment: attachments,
    };
    return accountDto;
}
