import type { Account } from '@/account/account.entity';
import { getAccountHandleHost } from '@/account/utils';

function withoutWww(host: string) {
    return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Domains an account could use as its Bluesky handle, best first
 *
 * The account's fediverse handle domain comes first (`example.com` for a site
 * on `www.example.com`, or a custom webfinger domain), then the site's own
 * host, so a site on `www.` still gets a handle if its root domain is taken
 */
export function getDomainHandleCandidates(
    account: Pick<Account, 'apId' | 'webfingerHost'>,
): string[] {
    const candidates = [
        withoutWww(getAccountHandleHost(account)),
        account.apId.hostname.toLowerCase(),
    ];

    return [...new Set(candidates)];
}
