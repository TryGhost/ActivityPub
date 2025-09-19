#!/usr/bin/env bash

set -euo pipefail

JOB_NAME=$1

if [ -z "$JOB_NAME" ]; then
  echo "Error: Job name is required"
  exit 1
fi

if [ -d "$JOB_NAME" ]; then
  echo "Error: Job '$JOB_NAME' already exists"
  exit 1
fi

cp -r __template__ "$JOB_NAME"

for file in "$JOB_NAME"/*; do
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/__JOB_NAME__/$JOB_NAME/g" "$file"
  else
    sed -i "s/__JOB_NAME__/$JOB_NAME/g" "$file"
  fi
done

echo "Job '$JOB_NAME' created successfully!"
