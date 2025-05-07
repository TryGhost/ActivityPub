UPDATE accounts
SET domain = SUBSTRING_INDEX(SUBSTRING_INDEX(ap_id, '/', 3), '/', -1)
WHERE domain IS NULL OR domain = '';
