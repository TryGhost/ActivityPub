CREATE TABLE ghost_ap_post_mappings (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),

    -- The uuid of the ghost post
    ghost_uuid CHAR(36) NOT NULL UNIQUE,

    -- The ap id of the ap post
    ap_id VARCHAR(1024) NOT NULL,
    ap_id_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(ap_id, 256))) STORED UNIQUE
);
