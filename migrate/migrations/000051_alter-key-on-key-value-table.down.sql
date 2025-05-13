/*  This migration was executed manually.
    The alter table query executed on a very large table can cause downtime
    Instead, it was executed with gh-ost
        $ docker run -it \
            -e DB_USER=${DB_USER} \
            -e DB_PASS=${DB_PASS} \
            -e DB_HOST=${DB_HOST} \
            -e DB_NAME=${DB_NAME} \
            gh-ost bash
        $ gh-ost \
            --user="${DB_USER}" \
            --password="${DB_PASS}" \
            --host="${DB_HOST}" \
            --database="${DB_NAME}" \
            --table="key_value" \
            --verbose \
            --alter="MODIFY \`key\` VARCHAR(256)" \
            --allow-on-master \
            --exact-rowcount \
            --concurrent-rowcount \
            --default-retries=120 \
            --ssl \
            --ssl-allow-insecure \
            --execute
*/
ALTER TABLE key_value MODIFY `key` VARCHAR(256);
