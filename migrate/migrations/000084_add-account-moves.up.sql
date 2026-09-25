CREATE TABLE account_moves (
    account_id INT UNSIGNED PRIMARY KEY,
    target_ap_id VARCHAR(1024) NOT NULL,
    activity_id VARCHAR(1024) NOT NULL,
    claimed_at TIMESTAMP(6) NULL,
    sent_at TIMESTAMP(6) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
);
