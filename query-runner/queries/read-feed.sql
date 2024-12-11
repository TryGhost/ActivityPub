SELECT
    posts.title AS post_title,
    posts.content AS post_content,
    posts.type AS post_type,
    accounts.name AS author_name,
    accounts.username AS author_username,
    CASE
        WHEN likes.user_id IS NOT NULL THEN 1
        ELSE 0
    END AS has_liked,
    CASE
        WHEN follows.follower_id IS NOT NULL THEN 1
        ELSE 0
    END AS is_following_author
FROM
    feeds
INNER JOIN posts
    ON feeds.post_id = posts.internal_id
INNER JOIN accounts
    ON posts.author_id = accounts.internal_id
LEFT JOIN likes
    ON likes.post_id = posts.internal_id
    AND likes.user_id = feeds.user_id
LEFT JOIN follows
    ON follows.following_id = feeds.user_id
    AND follows.follower_id = feeds.author_id
WHERE
    feeds.user_id = 189856
ORDER BY feeds.internal_id DESC
LIMIT 50
OFFSET 0;