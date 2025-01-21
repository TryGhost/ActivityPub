CREATE TABLE accounts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    username VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    bio TEXT,
    avatar_url VARCHAR(1024),
    banner_image_url VARCHAR(1024),
    url VARCHAR(1024),

    custom_fields JSON,

    ap_id VARCHAR(1024) NOT NULL,
    ap_inbox_url VARCHAR(1024) NOT NULL,
    ap_shared_inbox_url VARCHAR(1024),
    ap_public_key TEXT,
    ap_private_key TEXT,

    KEY idx_accounts_username (username)
);
