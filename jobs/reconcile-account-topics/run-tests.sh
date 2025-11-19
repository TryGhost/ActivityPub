#!/usr/bin/env bash

echo "Starting test database..."
docker-compose up -d

echo "Waiting for MySQL to be ready..."
for i in {1..30}; do
    if docker exec "$(docker-compose ps -q mysql-test)" mysqladmin ping -h"localhost" -P"3306" -u"root" -p"root" --silent 2>/dev/null; then
        echo "MySQL is ready!"
        sleep 2
        break
    fi
    echo "Waiting for MySQL... ($i/30)"
    sleep 1
done

echo "Running tests..."
bun test

echo "Stopping test database..."
docker-compose down
