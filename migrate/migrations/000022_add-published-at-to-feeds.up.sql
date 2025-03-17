ALTER TABLE feeds ADD COLUMN published_at TIMESTAMP;

UPDATE feeds 
JOIN posts ON feeds.post_id = posts.id 
SET feeds.published_at = posts.published_at;

ALTER TABLE feeds MODIFY COLUMN published_at TIMESTAMP NOT NULL;

CREATE INDEX idx_published_at ON feeds(published_at);
