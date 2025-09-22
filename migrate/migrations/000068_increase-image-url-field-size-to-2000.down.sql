/*  This rollback migration should be executed manually in production.
    The alter table query executed on a very large table can cause downtime
    Instead, it should be executed with gh-ost
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
            --table="posts" \
            --verbose \
            --alter="MODIFY image_url VARCHAR(1024) NULL" \
            --allow-on-master \
            --exact-rowcount \
            --concurrent-rowcount \
            --default-retries=120 \
            --ssl \
            --ssl-allow-insecure \
            --execute
*/
ALTER TABLE posts MODIFY image_url VARCHAR(1024) NULL;