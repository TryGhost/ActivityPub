CREATE TABLE discovery_feeds (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),

    post_type TINYINT UNSIGNED,
    published_at TIMESTAMP(6) NOT NULL,

    topic_id INT UNSIGNED NOT NULL,
    post_id INT UNSIGNED NOT NULL,
    author_id INT UNSIGNED NOT NULL,

    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE CASCADE,

    KEY idx_discovery_feeds_post_type (post_type),
    KEY idx_discovery_feeds_published_at (published_at),
    KEY idx_discovery_feeds_topic_id (topic_id)
);
