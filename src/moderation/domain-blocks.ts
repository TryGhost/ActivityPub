import type { Knex } from 'knex';

/**
 * Join condition matching a domain block against an account.
 *
 * An account can be seen under two domains: the host its actor lives on, and
 * the custom handle host from its WebFinger subject. A block is recorded with
 * whichever one the reader was shown, so both have to match, otherwise storing
 * a custom host would silently unblock an account blocked from a surface that
 * displayed the actor host.
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
