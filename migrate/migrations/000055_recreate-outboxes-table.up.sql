DROP TABLE IF EXISTS outboxes;

CREATE TABLE outboxes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36) NOT NULL UNIQUE DEFAULT (UUID()),
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
    published_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),

    post_type TINYINT UNSIGNED NOT NULL,
    outbox_type TINYINT UNSIGNED NOT NULL,

    account_id INT UNSIGNED NOT NULL,
    post_id INT UNSIGNED NOT NULL,
    author_id INT UNSIGNED NOT NULL,

    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (author_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE,

    UNIQUE KEY uniq_outboxes_account_post_outbox_type (account_id, post_id, outbox_type),
    KEY idx_outboxes_account_id_outbox_type_published_at_desc (account_id, outbox_type, published_at DESC)
);
