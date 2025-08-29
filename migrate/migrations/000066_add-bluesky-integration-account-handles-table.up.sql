CREATE TABLE bluesky_integration_account_handles (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
    account_id INT UNSIGNED NOT NULL,
    handle VARCHAR(255) NOT NULL,

    UNIQUE KEY idx_bluesky_integration_account_handles_account (account_id),
    UNIQUE KEY idx_bluesky_integration_account_handles_handle (handle),

    CONSTRAINT fk_bluesky_integration_account_handles_account
        FOREIGN KEY (account_id) REFERENCES accounts(id)
        ON DELETE CASCADE
);
