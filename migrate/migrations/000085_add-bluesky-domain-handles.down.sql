ALTER TABLE bluesky_integration_account_handles
    DROP COLUMN did,
    DROP COLUMN domain_handle,
    DROP COLUMN domain_handle_status,
    DROP COLUMN domain_handle_reason,
    DROP COLUMN domain_handle_claimed_at;
