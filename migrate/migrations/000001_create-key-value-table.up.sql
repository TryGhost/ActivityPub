CREATE TABLE IF NOT EXISTS key_value (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(256) UNIQUE,
    value JSON NOT NULL,
    expires DATETIME NULL
);
