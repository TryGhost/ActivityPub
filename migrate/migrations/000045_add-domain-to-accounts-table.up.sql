ALTER TABLE accounts
    ADD COLUMN domain VARCHAR(255) NULL,  -- Nullable to allow for incremental migration
    ADD COLUMN domain_hash BINARY(32)
        GENERATED ALWAYS AS (UNHEX(SHA2(LOWER(domain), 256))) STORED;

CREATE INDEX idx_accounts_domain_hash ON accounts(domain_hash);
