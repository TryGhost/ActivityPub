CREATE TABLE hashtags (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),

    name VARCHAR(255) NOT NULL,
    name_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(name, 256))) STORED,

    UNIQUE KEY uk_hashtags_name_hash (name_hash),
    KEY idx_hashtags_name (name)
);

CREATE TABLE post_hashtags (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),

    post_id INT UNSIGNED NOT NULL,
    hashtag_id INT UNSIGNED NOT NULL,
    published_at TIMESTAMP(6) NOT NULL,

    UNIQUE KEY uk_post_hashtags_hashtag_post (hashtag_id, post_id),
    KEY idx_post_hashtags_hashtag_published_at (hashtag_id, published_at),

    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE
);
