DROP INDEX idx_published_at ON feeds;
ALTER TABLE feeds DROP COLUMN published_at;
