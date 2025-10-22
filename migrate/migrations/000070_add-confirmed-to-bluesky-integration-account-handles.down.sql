ALTER TABLE bluesky_integration_account_handles
    DROP COLUMN confirmed,
    MODIFY COLUMN handle VARCHAR(255) NOT NULL;
