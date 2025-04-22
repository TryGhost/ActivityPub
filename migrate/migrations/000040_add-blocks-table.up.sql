CREATE TABLE blocks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),

    blocker_id INT UNSIGNED NOT NULL,
    blocked_id INT UNSIGNED NOT NULL,

    UNIQUE KEY unique_blocker_blocked (blocker_id, blocked_id),

    FOREIGN KEY (blocker_id) REFERENCES accounts(id),
    FOREIGN KEY (blocked_id) REFERENCES accounts(id),

    KEY idx_blocks_blocked_id_blocker_id (blocked_id, blocker_id)
);
