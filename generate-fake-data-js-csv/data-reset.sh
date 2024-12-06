#!/usr/bin/env bash

echo "Resetting data..."

if ls ./data/*.csv 1> /dev/null 2>&1; then
    rm ./data/*.csv
fi

if [ -d "./data/gz" ]; then
    rm -rf ./data/gz
fi
