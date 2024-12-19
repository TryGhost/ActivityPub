#!/usr/bin/env bash

echo "Compressing data..."

mkdir -p ./data/gz

for file in ./data/*.csv; do
    if [ -f "$file" ]; then
        echo "Compressing $file..."

        pigz -c "$file" > "./data/gz/$(basename "$file").gz"
    fi
done
