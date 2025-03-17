#!/usr/bin/env bash

set -e

export DATA_DIR=./data

mkdir -p $DATA_DIR

node generate-data.js
node generate-follows.js
node generate-feeds.js
