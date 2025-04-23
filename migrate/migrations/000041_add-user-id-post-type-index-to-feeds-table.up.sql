CREATE INDEX idx_feeds_user_id_post_type ON feeds(user_id, post_type, published_at DESC);
