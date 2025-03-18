UPDATE feeds
JOIN posts ON feeds.post_id = posts.id
SET feeds.published_at = posts.published_at
WHERE feeds.reposted_by_id IS NULL;
