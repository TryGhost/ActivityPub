#!/usr/bin/env bash

echo "Exporting database..."

docker exec -i scale-testing-db mysqldump -uroot -proot activitypub | gzip > data/activitypub.sql.gz
