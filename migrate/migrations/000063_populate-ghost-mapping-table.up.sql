START TRANSACTION;

-- Delete all existing data from ghost_ap_post_mappings table to avoid duplicates
DELETE FROM ghost_ap_post_mappings;

-- Populate ghost_ap_post_mappings table with Article posts from internal users
INSERT INTO ghost_ap_post_mappings (
    ghost_uuid,
    ap_id
)
SELECT DISTINCT
    posts.uuid AS ghost_uuid,
    posts.ap_id AS ap_id
FROM posts
INNER JOIN accounts ON accounts.id = posts.author_id
INNER JOIN users ON users.account_id = accounts.id -- This makes sure that the account is internal
WHERE posts.type = 1  -- Article type
  AND posts.deleted_at IS NULL; -- Skip the deleted posts


COMMIT;
