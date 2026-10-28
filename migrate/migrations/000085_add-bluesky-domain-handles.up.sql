ALTER TABLE bluesky_integration_account_handles
    ADD COLUMN did VARCHAR(255) NULL,
    ADD COLUMN domain_handle VARCHAR(255) NULL,
    ADD COLUMN domain_handle_status VARCHAR(32) NULL,
    ADD COLUMN domain_handle_reason VARCHAR(32) NULL,
    ADD COLUMN domain_handle_claimed_at TIMESTAMP(6) NULL,
    ADD COLUMN domain_handle_automatic BOOLEAN NOT NULL DEFAULT FALSE;
