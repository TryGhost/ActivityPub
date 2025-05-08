ALTER TABLE domain_blocks
    ADD COLUMN domain_hash BINARY(32)
        GENERATED ALWAYS AS (UNHEX(SHA2(LOWER(domain), 256))) STORED;

-- Add a new unique constraint on (blocker_id, domain_hash)
ALTER TABLE domain_blocks
    ADD CONSTRAINT unique_blocker_domain_hash UNIQUE (blocker_id, domain_hash);

-- Index for single column lookups
CREATE INDEX idx_domain_blocks_domain_hash ON domain_blocks(domain_hash);
