CREATE TABLE account_delivery_backoffs (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

    -- The account that we failed to deliver to
    account_id INT UNSIGNED NOT NULL,

    -- Track failure details
    last_failure_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_failure_reason TEXT,

    -- Exponential backoff tracking
    backoff_until TIMESTAMP(6) NOT NULL,
    backoff_seconds INT UNSIGNED NOT NULL DEFAULT 60,

    UNIQUE KEY idx_account_delivery_backoffs_account (account_id),
    KEY idx_account_delivery_backoffs_backoff (backoff_until),

    CONSTRAINT fk_account_delivery_backoffs_account
        FOREIGN KEY (account_id) REFERENCES accounts(id)
        ON DELETE CASCADE
);
