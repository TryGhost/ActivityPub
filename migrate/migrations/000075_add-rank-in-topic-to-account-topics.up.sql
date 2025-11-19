ALTER TABLE account_topics ADD COLUMN rank_in_topic INT UNSIGNED NOT NULL DEFAULT 0;

CREATE INDEX idx_account_topics_topic_id_rank_in_topic ON account_topics(topic_id, rank_in_topic);
