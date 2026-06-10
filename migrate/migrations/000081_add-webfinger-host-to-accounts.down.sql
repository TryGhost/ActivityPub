DROP INDEX idx_accounts_username_webfinger_host_hash ON accounts;
DROP INDEX idx_accounts_webfinger_host_hash ON accounts;
DROP INDEX idx_accounts_fulltext_search ON accounts;
CREATE FULLTEXT INDEX idx_accounts_fulltext_search
    ON accounts(name, username, domain);

ALTER TABLE accounts
    DROP COLUMN webfinger_host_hash,
    DROP COLUMN webfinger_host;
