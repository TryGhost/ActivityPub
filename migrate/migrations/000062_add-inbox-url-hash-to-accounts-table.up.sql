ALTER TABLE accounts
    ADD COLUMN ap_inbox_url_hash BINARY(32)
        GENERATED ALWAYS AS (UNHEX(SHA2(LOWER(ap_inbox_url), 256))) STORED;

CREATE INDEX idx_accounts_ap_inbox_url_hash ON accounts(ap_inbox_url_hash);
