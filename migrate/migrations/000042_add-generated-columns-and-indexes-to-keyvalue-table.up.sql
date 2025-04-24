ALTER TABLE key_value
    ADD COLUMN object VARCHAR(255)
    GENERATED ALWAYS AS (
        CASE
            WHEN REGEXP_LIKE(JSON_UNQUOTE(value->>"$.object"), '^https')
            THEN LEFT(JSON_UNQUOTE(value->>"$.object"), 255)
            ELSE ''
        END) STORED;

CREATE INDEX idx_object ON key_value(object);

ALTER TABLE key_value
    ADD COLUMN json_id VARCHAR(255)
    GENERATED ALWAYS AS (
        CASE
            WHEN REGEXP_LIKE(JSON_UNQUOTE(value->>"$.id"), '^https')
            THEN LEFT(JSON_UNQUOTE(value->>"$.id"), 255)
            ELSE ''
        END) STORED;

CREATE INDEX idx_json_id ON key_value(json_id);
