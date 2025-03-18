UPDATE feeds
SET feeds.published_at = feeds.created_at
WHERE feeds.published_at IS NULL;

ALTER TABLE feeds MODIFY COLUMN published_at TIMESTAMP NOT NULL;
