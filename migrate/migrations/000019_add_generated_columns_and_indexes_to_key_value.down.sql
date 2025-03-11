DROP INDEX idx_object_id ON key_value;
ALTER TABLE key_value DROP COLUMN object_id;

DROP INDEX idx_object_in_reply_to ON key_value;
ALTER TABLE key_value DROP COLUMN object_in_reply_to;
