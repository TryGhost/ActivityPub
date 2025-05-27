START TRANSACTION;

-- Delete all existing data from outboxes table to avoid duplicates
DELETE FROM outboxes;

-- Populate outboxes table with original posts from users (excluding replies)
INSERT INTO outboxes (
    post_type,
    outbox_type,
    account_id,
    post_id,
    author_id,
    published_at
)
SELECT
    posts.type AS post_type,
    0 AS outbox_type, -- 0 for original posts
    accounts.id AS account_id,
    posts.id AS post_id,
    posts.author_id AS author_id,
    posts.published_at AS published_at
FROM posts
INNER JOIN accounts ON accounts.id = posts.author_id
INNER JOIN users ON users.account_id = accounts.id
WHERE posts.deleted_at IS NULL
  AND posts.in_reply_to IS NULL;

-- Populate outboxes table with replies from users
INSERT INTO outboxes (
    post_type,
    outbox_type,
    account_id,
    post_id,
    author_id,
    published_at
)
SELECT
    posts.type AS post_type,
    2 AS outbox_type, -- 2 for replies
    accounts.id AS account_id,
    posts.id AS post_id,
    posts.author_id AS author_id,
    posts.published_at AS published_at
FROM posts
INNER JOIN accounts ON accounts.id = posts.author_id
INNER JOIN users ON users.account_id = accounts.id
WHERE posts.deleted_at IS NULL
  AND posts.in_reply_to IS NOT NULL;

-- Populate outboxes table with reposts from users
INSERT INTO outboxes (
    post_type,
    outbox_type,
    account_id,
    post_id,
    author_id,
    published_at
)
SELECT
    posts.type AS post_type,
    1 AS outbox_type, -- 1 for reposts
    accounts.id AS account_id,
    reposts.post_id AS post_id,
    posts.author_id AS author_id,
    reposts.created_at AS published_at
FROM reposts
INNER JOIN posts ON posts.id = reposts.post_id
INNER JOIN accounts ON accounts.id = reposts.account_id
INNER JOIN users ON users.account_id = accounts.id
WHERE posts.deleted_at IS NULL;

COMMIT;
