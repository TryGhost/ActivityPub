ALTER TABLE accounts
ADD COLUMN ap_outbox_url VARCHAR(1024),
ADD COLUMN ap_following_url VARCHAR(1024),
ADD COLUMN ap_followers_url VARCHAR(1024),
ADD COLUMN ap_liked_url VARCHAR(1024);
