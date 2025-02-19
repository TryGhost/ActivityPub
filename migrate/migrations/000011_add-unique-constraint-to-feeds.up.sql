ALTER TABLE feeds ADD CONSTRAINT uniq_feeds_user_post UNIQUE (user_id, post_id, reposted_by_id);
