#!/usr/bin/env bash

# If you change these, make sure to update run.sh
MYSQL_ROOT_PASSWORD=root
MYSQL_DATABASE=activitypub
MYSQL_PORT=3307

CONTAINER_NAME=scale-testing-db

# Stop container if already running
if [ "$(docker ps -q -f name=$CONTAINER_NAME)" ]; then
    echo "Database already running, stopping..."
    docker stop $CONTAINER_NAME > /dev/null
fi

echo "Starting database..."

docker run --rm --name $CONTAINER_NAME \
    -e MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD \
    -e MYSQL_DATABASE=$MYSQL_DATABASE \
    -p $MYSQL_PORT:3306 \
    -v $(pwd)/../schema/tables.sql:/docker-entrypoint-initdb.d/tables.sql \
    -d mysql:8.0 \
    > /dev/null

echo "Database started!"
