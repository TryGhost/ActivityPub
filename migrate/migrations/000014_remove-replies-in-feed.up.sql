DELETE feeds
FROM feeds
INNER JOIN posts ON feeds.post_id = posts.id
WHERE posts.in_reply_to IS NOT NULL;
