#!/usr/bin/env bash

# If you change these, make sure to update db-init.sh
MYSQL_HOST=host.docker.internal
MYSQL_PORT=3307
MYSQL_USER=root
MYSQL_PASSWORD=root
MYSQL_DATABASE=activitypub

docker build -t generate-fake-data-js-db .

docker run --rm --tty --name generate-fake-data-js-db \
    -e MYSQL_HOST=$MYSQL_HOST \
    -e MYSQL_PORT=$MYSQL_PORT \
    -e MYSQL_USER=$MYSQL_USER \
    -e MYSQL_PASSWORD=$MYSQL_PASSWORD \
    -e MYSQL_DATABASE=$MYSQL_DATABASE \
    generate-fake-data-js-db $@
