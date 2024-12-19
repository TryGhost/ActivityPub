-- These are the sites that we support - we have this table already
CREATE TABLE sites (
    internal_id INT AUTO_INCREMENT PRIMARY KEY,
    host VARCHAR(255) NOT NULL UNIQUE,
    webhook_secret VARCHAR(255) NOT NULL
);

-- These are activitypub accounts, both local and remote
CREATE TABLE accounts (
    internal_id INT AUTO_INCREMENT PRIMARY KEY,
    # id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(255)
);

-- These are our users - they're tied to an activitypub account
CREATE TABLE users (
    internal_id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    site_id INT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(internal_id) ON DELETE CASCADE,
    FOREIGN KEY (site_id) REFERENCES sites(internal_id) ON DELETE CASCADE
);

-- Posts are things that appear in the feed
CREATE TABLE posts (
    internal_id INT AUTO_INCREMENT PRIMARY KEY,
    # id VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(255),
    content TEXT NOT NULL,
    author_id INT NOT NULL,
    type TINYINT NOT NULL, # an enum for article/note/etc...
    FOREIGN KEY (author_id) REFERENCES accounts(internal_id) ON DELETE CASCADE
);

-- This is the "join" table which determines which posts are in a users feed
-- Anything we want to order or filter the feed on needs to be duplicated here
CREATE TABLE feeds (
    internal_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    post_id INT NOT NULL,
    author_id INT NOT NULL, # author_id here so we can delete where on it
    type TINYINT NOT NULL, # type here so we can filter on it
    FOREIGN KEY (user_id) REFERENCES users(internal_id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(internal_id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES accounts(internal_id) ON DELETE CASCADE
);

CREATE TABLE likes (
    internal_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    post_id INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(internal_id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(internal_id) ON DELETE CASCADE,
    UNIQUE(user_id, post_id)
);

-- This handles storing all follows in both directions for local and remote accounts
CREATE TABLE follows (
    internal_id INT AUTO_INCREMENT PRIMARY KEY,
    follower_id INT NOT NULL,
    following_id INT NOT NULL,
    UNIQUE KEY unique_follower_following (follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES accounts(internal_id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES accounts(internal_id) ON DELETE CASCADE
);
