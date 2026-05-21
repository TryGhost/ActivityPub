ALTER TABLE accounts
    ADD COLUMN webfinger_host VARCHAR(255) NULL,
    ADD COLUMN webfinger_host_hash BINARY(32)
        GENERATED ALWAYS AS (UNHEX(SHA2(LOWER(webfinger_host), 256))) STORED;

DROP INDEX idx_accounts_fulltext_search ON accounts;
CREATE FULLTEXT INDEX idx_accounts_fulltext_search
    ON accounts(name, username, domain, webfinger_host);

CREATE UNIQUE INDEX idx_accounts_username_webfinger_host_hash
    ON accounts(username, webfinger_host_hash);

CREATE INDEX idx_accounts_webfinger_host_hash
    ON accounts(webfinger_host_hash);
