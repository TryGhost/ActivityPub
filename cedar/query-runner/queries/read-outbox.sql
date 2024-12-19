SELECT
    posts.title AS post_title,
    posts.content AS post_content,
    posts.type AS post_type
FROM 
    posts
WHERE
    posts.author_id = 1
    AND posts.type = 2
ORDER BY
    posts.internal_id DESC
LIMIT 50
OFFSET 0;