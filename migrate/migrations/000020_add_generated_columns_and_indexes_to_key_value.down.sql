DROP INDEX idx_object_id ON key_value;
ALTER TABLE key_value DROP COLUMN object_id;

DROP INDEX idx_object_in_reply_to ON key_value;
ALTER TABLE key_value DROP COLUMN object_in_reply_to;

ALTER TABLE key_value
    ADD COLUMN object_id VARCHAR(150)
    GENERATED ALWAYS AS (
        CASE
            WHEN REGEXP_LIKE(JSON_UNQUOTE(value->>"$.object.id"), '^https')
            THEN JSON_UNQUOTE(value->>"$.object.id")
            ELSE ''
        END) STORED;

CREATE INDEX idx_object_id ON key_value(object_id);

ALTER TABLE key_value
    ADD COLUMN object_in_reply_to VARCHAR(150)
    GENERATED ALWAYS AS (
        CASE
            WHEN REGEXP_LIKE(JSON_UNQUOTE(value->>"$.object.inReplyTo"), '^https')
            THEN JSON_UNQUOTE(value->>"$.object.inReplyTo")
        ELSE ''
        END) STORED;

CREATE INDEX idx_object_in_reply_to ON key_value(object_in_reply_to);
