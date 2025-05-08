-- Drop the unique constraint on (blocker_id, domain_hash)
ALTER TABLE domain_blocks
    DROP INDEX unique_blocker_domain_hash;

-- Drop the single column index
DROP INDEX idx_domain_blocks_domain_hash ON domain_blocks;

-- Drop the column
ALTER TABLE domain_blocks
    DROP COLUMN domain_hash;
