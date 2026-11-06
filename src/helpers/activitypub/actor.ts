import { type Actor, PropertyValue } from '@fedify/vocab';

import type { AccountService } from '@/account/account.service';
import { HANDLE_REGEX } from '@/constants';
import type { Site } from '@/site/site.service';

interface Attachment {
    name: string;
    value: string;
}

export async function getAttachments(
    actor: Actor,
    options?: {
        sanitizeValue?: (content: string) => string;
    },
): Promise<Attachment[]> {
    const attachments: Attachment[] = [];

    for await (const attachment of actor.getAttachments()) {
        if (!(attachment instanceof PropertyValue)) {
            continue;
        }

        const name = attachment.name?.toString() || '';
        let value = attachment.value?.toString() || '';

        if (options?.sanitizeValue) {
            value = options.sanitizeValue(value);
        }

        attachments.push({ name, value });
    }

    return attachments;
}

export function getHandle(actor: Actor): string {
    const host = actor.id?.host?.replace(/^www./, '') || 'unknown';

    return `@${actor?.preferredUsername || 'unknown'}@${host}`;
}

export async function isFollowedByDefaultSiteAccount(
    actor: Actor,
    site: Site,
    accountService: AccountService,
) {
    const followeeAccount = await accountService.getAccountByApId(
        actor.id?.toString() || '',
    );

    if (!followeeAccount) {
        return false;
    }

    const siteDefaultAccount =
        await accountService.getDefaultAccountForSite(site);

    if (!siteDefaultAccount) {
        throw new Error(`Default account not found for site: ${site.id}`);
    }

    return await accountService.checkIfAccountIsFollowing(
        siteDefaultAccount.id,
        followeeAccount.id,
    );
}

export function isHandle(handle: string): boolean {
    return new RegExp(`^${HANDLE_REGEX.source}$`).test(handle);
}

/** Last non-empty path segment of an actor ID (`…/users/index` → `index`). */
export function actorPathIdentifier(apId: URL): string | null {
    return apId.pathname.split('/').filter(Boolean).at(-1) || null;
}

/** Whether `{identifier}` matches the account's canonical actor path. */
export function matchesActorPathIdentifier(
    apId: URL,
    identifier: string,
): boolean {
    const expected = actorPathIdentifier(apId);
    return expected !== null && identifier === expected;
}

/**
 * WebFinger `acct:` local-part match: preferred username or the actor path
 * segment (so `acct:index@…` still works after a display-username change).
 */
export function matchesWebFingerUsername(
    account: { username: string; apId: URL },
    username: string,
): boolean {
    return (
        account.username === username ||
        actorPathIdentifier(account.apId) === username
    );
}
