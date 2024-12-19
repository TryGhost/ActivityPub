BEGIN;

INSERT INTO posts (title, content, author_id, `type`) VALUES ('Inserted post', 'Hello, world!', 456, 1);

INSERT INTO feeds (user_id, post_id, author_id, `type`)
SELECT 
    users.internal_id AS user_id, 
    LAST_INSERT_ID() AS post_id, 
    123 AS author_id,
    1 AS type
FROM 
    follows
JOIN users 
    ON follows.follower_id = users.account_id
WHERE 
    follows.following_id = 456;

COMMIT;