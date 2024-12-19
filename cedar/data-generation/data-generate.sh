#!/usr/bin/env bash

set -e

export DATA_DIR=./data/generated_$(date +%Y-%m-%d_%H-%M-%S)

mkdir -p $DATA_DIR

node generate-data.js
node generate-follows.js
node generate-feeds.js
