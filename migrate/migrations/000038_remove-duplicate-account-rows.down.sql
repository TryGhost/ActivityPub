ALTER TABLE accounts
DROP INDEX idx_ap_id_hash;

ALTER TABLE accounts
DROP COLUMN ap_id_hash;
