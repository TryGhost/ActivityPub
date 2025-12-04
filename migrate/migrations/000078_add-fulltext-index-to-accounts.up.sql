-- Standard FULLTEXT for multi-word fields (name, bio)
ALTER TABLE accounts ADD FULLTEXT INDEX idx_accounts_fulltext_name_bio (name, bio);

-- N-gram FULLTEXT for single-token fields (username, domain) to enable substring matching
ALTER TABLE accounts ADD FULLTEXT INDEX idx_accounts_fulltext_username_domain (username, domain) WITH PARSER ngram;
