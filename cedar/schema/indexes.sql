-- Fast lookup of site for each request
CREATE INDEX idx_sites_host ON sites (host);

-- Lookup of account from standard AP id
-- CREATE INDEX idx_accounts_id ON accounts (id);

-- Lookup of account via username and host
CREATE INDEX idx_accounts_username ON accounts (username);
CREATE INDEX idx_users_account_id ON users (account_id);
CREATE INDEX idx_users_site_id ON users (site_id);

-- Get all posts from an author
CREATE INDEX idx_posts_author_id ON posts (author_id);

-- Get feed items for a user
CREATE INDEX idx_feeds_user_id ON feeds (user_id);

-- Not sure if we need this?
CREATE INDEX idx_feeds_post_id ON feeds (post_id);

-- Get users liked posts
CREATE INDEX idx_likes_user_id ON likes (user_id);

-- Get internal liked count for post
CREATE INDEX idx_likes_post_id ON likes (post_id);

-- Lookup followers in both directions
CREATE INDEX idx_follows_follower_id_following_id ON follows (follower_id, following_id);
CREATE INDEX idx_follows_following_id_follower_id ON follows (following_id, follower_id);
