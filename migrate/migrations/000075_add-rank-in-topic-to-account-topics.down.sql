DROP INDEX idx_account_topics_topic_id_rank_in_topic ON account_topics;

ALTER TABLE account_topics DROP COLUMN rank_in_topic;

