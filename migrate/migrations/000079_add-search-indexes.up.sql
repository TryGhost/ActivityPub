-- Add indexes to improve search performance

-- Index on accounts.name for prefix searches (LIKE 'query%')
CREATE INDEX idx_accounts_name ON accounts(name);

-- Index on accounts.domain for prefix searches (LIKE 'query%')
CREATE INDEX idx_accounts_domain ON accounts(domain);

-- Index on users.account_id for Ghost site lookup join
CREATE INDEX idx_users_account_id ON users(account_id);
