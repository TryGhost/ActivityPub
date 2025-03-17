ALTER TABLE feeds ADD COLUMN published_at TIMESTAMP NOT NULL;

UPDATE feeds 
JOIN posts ON feeds.post_id = posts.id 
SET feeds.published_at = posts.published_at;

CREATE INDEX idx_published_at ON feeds(published_at);
