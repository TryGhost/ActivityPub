START TRANSACTION;

-- Create the global feed site
INSERT INTO sites (
    host,
    webhook_secret,
    ghost_pro
)
VALUES (
    'ap-global-feed.ghost.io',
    (SELECT LOWER(SHA2('ap-global-feed.ghost.io', 256))),
    1
);

SET @site_id := LAST_INSERT_ID();

-- Create the global feed account
INSERT INTO accounts (
    username,
    name,
    bio,
    avatar_url,
    banner_image_url,
    url,
    custom_fields,
    ap_id,
    ap_inbox_url,
    ap_shared_inbox_url,
    ap_public_key,
    ap_private_key,
    ap_outbox_url,
    ap_following_url,
    ap_followers_url,
    ap_liked_url,
    uuid,
    domain
)
VALUES (
    'index',
    'ActivityPub Global Feed',
    'ActivityPub Global Feed',
    NULL,
    NULL,
    'https://ap-global-feed.ghost.io/',
    NULL,
    'https://ap-global-feed.ghost.io/.ghost/activitypub/users/index',
    'https://ap-global-feed.ghost.io/.ghost/activitypub/inbox/index',
    NULL,
    NULL,
    NULL,
    'https://ap-global-feed.ghost.io/.ghost/activitypub/outbox/index',
    'https://ap-global-feed.ghost.io/.ghost/activitypub/following/index',
    'https://ap-global-feed.ghost.io/.ghost/activitypub/followers/index',
    'https://ap-global-feed.ghost.io/.ghost/activitypub/liked/index',
    (SELECT UUID()),
    'ap-global-feed.ghost.io'
);

SET @account_id := LAST_INSERT_ID();

-- Create the global feed user
INSERT INTO users (
    account_id,
    site_id
)
VALUES (
    @account_id,
    @site_id
);

COMMIT;
