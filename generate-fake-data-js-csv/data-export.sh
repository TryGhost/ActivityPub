#!/usr/bin/env bash

echo "Compressing data..."

mkdir -p ./data/gz

for file in ./data/*.csv; do
    if [ -f "$file" ]; then
        echo "Compressing $file..."

        gzip -9 -c "$file" > "./data/gz/$(basename "$file").gz"
    fi
done
