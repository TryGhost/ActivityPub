CREATE TABLE notifications (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    event_type TINYINT UNSIGNED NOT NULL,

    user_id INT UNSIGNED NOT NULL,
    account_id INT UNSIGNED NOT NULL,
    post_id INT UNSIGNED NULL,
    in_reply_to_post_id INT UNSIGNED NULL,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (in_reply_to_post_id) REFERENCES posts(id) ON DELETE CASCADE,
    KEY idx_notifications_user_id (user_id, id DESC)
);
