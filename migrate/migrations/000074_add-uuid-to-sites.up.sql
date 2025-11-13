-- TODO: Ensure non nullable once all sites have a uuid (future migration)
ALTER TABLE sites ADD COLUMN uuid CHAR(36) NULL UNIQUE;
