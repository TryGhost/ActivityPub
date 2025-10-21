START TRANSACTION;

-- Delete the global feed user by finding it via the account's AP ID hash
DELETE users FROM users
INNER JOIN accounts ON accounts.id = users.account_id
WHERE accounts.ap_id_hash = UNHEX(SHA2('https://ap-global-feed.ghost.io/.ghost/activitypub/users/index', 256));

-- Delete the global feed account by finding it via the account's AP ID hash
DELETE FROM accounts
WHERE ap_id_hash = UNHEX(SHA2('https://ap-global-feed.ghost.io/.ghost/activitypub/users/index', 256));

-- Delete the global feed site by finding it via the site's host
DELETE FROM sites
WHERE host = 'ap-global-feed.ghost.io';

COMMIT;
