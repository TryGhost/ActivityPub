DROP INDEX idx_accounts_ap_inbox_url_hash ON accounts;

ALTER TABLE accounts
    DROP COLUMN ap_inbox_url_hash;
