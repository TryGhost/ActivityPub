import type { Knex } from 'knex';

/**
 * An account can be seen under two domains: the host its actor lives on, and
 * the custom handle host from its WebFinger subject.
 *
 * A domain block is recorded with whichever one the reader was shown
 * (`DomainBlockedEvent` carries the displayed host), so every comparison has to
 * consider both. Matching `domain_hash` alone lets a block taken from a surface
 * showing a custom handle hide the account from some surfaces while its posts,
 * follows and notifications survive, which is worse than not blocking at all.
 */

/**
 * Join condition matching a domain block against an account.
 */
export function domainBlockMatchesAccount(
    db: Knex,
    accountsTable = 'accounts',
): Knex.Raw {
    return db.raw('domain_blocks.domain_hash IN (??, ??)', [
        `${accountsTable}.domain_hash`,
        `${accountsTable}.webfinger_host_hash`,
    ]);
}

/**
 * Condition matching every account visible under `domain`.
 *
 * Used at block time, where the blocked domain is known and the accounts it
 * covers have to be found in order to tear down follows, posts and
 * notifications.
 */
export function accountMatchesDomain(
    db: Knex,
    domain: string,
    accountsTable = 'accounts',
): Knex.Raw {
    return db.raw(
        '(?? = UNHEX(SHA2(LOWER(?), 256)) OR ?? = UNHEX(SHA2(LOWER(?), 256)))',
        [
            `${accountsTable}.domain_hash`,
            domain,
            `${accountsTable}.webfinger_host_hash`,
            domain,
        ],
    );
}

/**
 * Whether a set of blocked domains covers an account known under any of
 * `hosts`.
 *
 * The in-memory counterpart to `domainBlockMatchesAccount`, for views that
 * already hold the reader's blocked domains. Pass every host the account can be
 * seen under — its actor host, its custom handle host, and for an actor
 * resolved from a collection, the URL the collection listed it under, which a
 * redirect to a canonical actor id can move to another domain.
 */
export function isAccountDomainBlocked(
    blockedDomains: Set<string>,
    ...hosts: (string | null | undefined)[]
): boolean {
    return hosts.some(
        (host) => !!host && blockedDomains.has(host.toLowerCase()),
    );
}
