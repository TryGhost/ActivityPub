CREATE TABLE account_topics (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    account_id INT UNSIGNED NOT NULL,
    topic_id INT UNSIGNED NOT NULL,

    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    UNIQUE KEY unique_account_topic (account_id, topic_id)
);
