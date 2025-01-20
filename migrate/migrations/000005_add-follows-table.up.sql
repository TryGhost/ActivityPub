CREATE TABLE follows (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    follower_id INT UNSIGNED NOT NULL,
    following_id INT UNSIGNED NOT NULL,

    UNIQUE KEY unique_follower_following (follower_id, following_id),

    FOREIGN KEY (follower_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES accounts(id) ON DELETE CASCADE,

    KEY idx_follows_follower_id_following_id (follower_id, following_id),
    KEY idx_follows_following_id_follower_id (following_id, follower_id)
);
