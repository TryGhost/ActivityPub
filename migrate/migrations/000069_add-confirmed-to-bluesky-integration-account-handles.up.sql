ALTER TABLE bluesky_integration_account_handles
    ADD COLUMN confirmed BOOLEAN DEFAULT FALSE NOT NULL,
    MODIFY COLUMN handle VARCHAR(255) NULL;
