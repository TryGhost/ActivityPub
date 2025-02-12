CREATE TABLE feeds (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    post_type TINYINT UNSIGNED,
    audience TINYINT UNSIGNED,

    user_id INT UNSIGNED NOT NULL,
    post_id INT UNSIGNED NOT NULL,
    author_id INT UNSIGNED NOT NULL,
    reposted_by_id INT UNSIGNED NULL,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (reposted_by_id) REFERENCES accounts(id) ON DELETE CASCADE,

    KEY idx_feeds_user_id (user_id),
    KEY idx_feeds_post_type (post_type),
    KEY idx_feeds_audience (audience)
);
