START TRANSACTION;

CREATE TEMPORARY TABLE account_masters (
    ap_id VARCHAR(255) NOT NULL,
    master_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (ap_id, master_id)
);

INSERT INTO account_masters
SELECT a.ap_id, MIN(a.id) as master_id
FROM accounts a
INNER JOIN users u ON a.id = u.account_id
GROUP BY a.ap_id;

CREATE TEMPORARY TABLE remaining_ap_ids AS
SELECT DISTINCT a.ap_id
FROM accounts a
LEFT JOIN account_masters am ON a.ap_id = am.ap_id
WHERE am.ap_id IS NULL;

INSERT INTO account_masters
SELECT a.ap_id, MIN(a.id) as master_id
FROM accounts a
INNER JOIN remaining_ap_ids r ON a.ap_id = r.ap_id
GROUP BY a.ap_id;

CREATE TEMPORARY TABLE accounts_to_migrate (
    duplicate_id BIGINT UNSIGNED NOT NULL,
    master_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (duplicate_id)
);

INSERT INTO accounts_to_migrate
SELECT a.id as duplicate_id, am.master_id
FROM accounts a
JOIN account_masters am ON a.ap_id = am.ap_id
WHERE a.id != am.master_id;

UPDATE feeds t
JOIN accounts_to_migrate atm ON t.author_id = atm.duplicate_id
SET t.author_id = atm.master_id;

UPDATE feeds t
JOIN accounts_to_migrate atm ON t.reposted_by_id = atm.duplicate_id
SET t.reposted_by_id = atm.master_id;

UPDATE follows t
JOIN accounts_to_migrate atm ON t.follower_id = atm.duplicate_id
SET t.follower_id = atm.master_id;

UPDATE follows t
JOIN accounts_to_migrate atm ON t.following_id = atm.duplicate_id
SET t.following_id = atm.master_id;

UPDATE notifications t
JOIN accounts_to_migrate atm ON t.account_id = atm.duplicate_id
SET t.account_id = atm.master_id;

UPDATE posts t
JOIN accounts_to_migrate atm ON t.author_id = atm.duplicate_id
SET t.author_id = atm.master_id;

UPDATE IGNORE likes t
JOIN accounts_to_migrate atm ON t.account_id = atm.duplicate_id
SET t.account_id = atm.master_id;

UPDATE IGNORE reposts t
JOIN accounts_to_migrate atm ON t.account_id = atm.duplicate_id
SET t.account_id = atm.master_id;

DELETE FROM accounts
WHERE id IN (SELECT duplicate_id FROM accounts_to_migrate);

ALTER TABLE accounts
ADD COLUMN ap_id_hash BINARY(32)
GENERATED ALWAYS AS (UNHEX(SHA2(ap_id, 256))) STORED;

ALTER TABLE accounts
ADD UNIQUE INDEX idx_ap_id_hash (ap_id_hash);

DROP TEMPORARY TABLE account_masters;
DROP TEMPORARY TABLE remaining_ap_ids;
DROP TEMPORARY TABLE accounts_to_migrate;

COMMIT;
