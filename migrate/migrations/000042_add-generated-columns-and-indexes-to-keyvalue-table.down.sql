DROP INDEX idx_object ON key_value(object);
ALTER TABLE key_value DROP COLUMN object;

DROP INDEX idx_json_id ON key_value(json_id);
ALTER TABLE key_value DROP COLUMN json_id;
