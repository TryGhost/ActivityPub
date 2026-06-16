-- Drop single-column indexes on feeds that are no longer used.
--
-- The composite index idx_feeds_user_id_post_type covers
-- (user_id, post_type, published_at DESC). Every feeds query pins user_id (and
-- usually post_type) first and only then ranges/orders on published_at, so it
-- can use the composite's leading columns. No query filters or orders on
-- published_at, post_type, or user_id on its own, so the single-column
-- idx_feeds_user_id, idx_feeds_post_type, and idx_published_at (all of which
-- predate the composite) are redundant.
--
-- idx_feeds_audience covers a column that is written on insert but never read,
-- filtered, or ordered by.
--
-- Removing them reduces write/storage overhead and prevents the optimizer from
-- combining the user_id and post_type indexes into an index-merge plan, which
-- scans far more rows than the composite index.
DROP INDEX idx_feeds_user_id ON feeds;
DROP INDEX idx_feeds_post_type ON feeds;
DROP INDEX idx_feeds_audience ON feeds;
DROP INDEX idx_published_at ON feeds;
