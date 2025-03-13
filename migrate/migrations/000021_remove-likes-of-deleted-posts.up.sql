DELETE likes FROM likes
INNER JOIN posts ON likes.post_id = posts.id
WHERE posts.deleted_at IS NOT NULL;
