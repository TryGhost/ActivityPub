CREATE TABLE IF NOT EXISTS key_value (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(2048),
    value JSON NOT NULL,
    expires DATETIME NULL
);
