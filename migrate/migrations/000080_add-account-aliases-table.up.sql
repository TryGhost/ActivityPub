CREATE TABLE account_aliases (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),

    account_id INT UNSIGNED NOT NULL,
    ap_id VARCHAR(1024) NOT NULL,
    ap_id_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(ap_id, 256))) STORED,

    UNIQUE KEY uk_account_alias (account_id, ap_id_hash),
    KEY idx_account_aliases_ap_id_hash (ap_id_hash),

    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
);
