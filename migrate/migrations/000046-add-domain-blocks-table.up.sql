CREATE TABLE domain_blocks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),

    blocker_id INT UNSIGNED NOT NULL,
    domain VARCHAR(255) NOT NULL,

    UNIQUE KEY unique_blocker_domain (blocker_id, domain),

    FOREIGN KEY (blocker_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE,
);
