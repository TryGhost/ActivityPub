ALTER TABLE feeds ADD COLUMN published_at TIMESTAMP DEFAULT '2020-01-01 00:00:00';

UPDATE feeds
JOIN posts ON feeds.post_id = posts.id
LEFT JOIN reposts ON reposts.post_id = posts.id AND reposts.account_id = feeds.reposted_by_id
SET feeds.published_at = CASE
    WHEN feeds.reposted_by_id IS NOT NULL THEN reposts.created_at
    ELSE posts.published_at
END;

ALTER TABLE feeds MODIFY COLUMN published_at TIMESTAMP NOT NULL;

CREATE INDEX idx_published_at ON feeds(published_at);
