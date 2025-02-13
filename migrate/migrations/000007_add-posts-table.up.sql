CREATE TABLE posts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    type TINYINT UNSIGNED NOT NULL,
    audience TINYINT UNSIGNED NOT NULL,

    author_id INT UNSIGNED NOT NULL,
    title VARCHAR(256) NULL,
    excerpt VARCHAR(500) NULL,
    content TEXT NULL,
    url VARCHAR(1024) NOT NULL,
    image_url VARCHAR(1024) NULL,
    published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    like_count INT UNSIGNED DEFAULT 0 NOT NULL,
    repost_count INT UNSIGNED DEFAULT 0 NOT NULL,
    reply_count INT UNSIGNED DEFAULT 0 NOT NULL,
    reading_time_minutes INT UNSIGNED DEFAULT 0 NOT NULL,

    ap_id VARCHAR(1024) NOT NULL,
    ap_id_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(ap_id, 256))) STORED UNIQUE,

    in_reply_to INT UNSIGNED NULL,
    thread_root INT UNSIGNED NULL,

    FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (in_reply_to) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (thread_root) REFERENCES posts(id) ON DELETE CASCADE
);
