CREATE TABLE mentions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),

    post_id INT UNSIGNED NOT NULL,
    account_id INT UNSIGNED NOT NULL,

    UNIQUE KEY unique_account_post (account_id, post_id),

    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
