-- TODO: Ensure non nullable once all sites have a ghost_uuid (future migration)
ALTER TABLE sites ADD COLUMN ghost_uuid CHAR(36) NULL UNIQUE;
