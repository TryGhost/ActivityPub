CREATE TABLE relay_sharing_accounts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    account_id INT UNSIGNED NOT NULL,

    UNIQUE KEY idx_relay_sharing_accounts_account_id (account_id),

    CONSTRAINT fk_relay_sharing_accounts_account
        FOREIGN KEY (account_id) REFERENCES accounts(id)
        ON DELETE CASCADE
);
