DROP INDEX idx_accounts_domain_hash ON accounts;

ALTER TABLE accounts
    DROP COLUMN domain_hash,
    DROP COLUMN domain;
