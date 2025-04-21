#!/bin/sh

# This script initializes the fake-gcs server and ensures the required bucket exists.
# It starts the server, waits for it to be ready, and creates the bucket if it doesn't exist.

# Ensure storage directory exists and has proper permissions
mkdir -p /storage
chmod 777 /storage

# Start the fake-gcs server in the background
fake-gcs-server -scheme http -port 4443 -external-url http://fake-gcs:4443 -data /storage &

# Wait for the server to be ready
sleep 1

# Check if bucket exists and create if it doesn't
if ! curl -s "http://localhost:4443/storage/v1/b/${GCP_BUCKET_NAME}" | grep -q "\"name\": \"${GCP_BUCKET_NAME}\""; then
    curl -X POST \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"${GCP_BUCKET_NAME}\"}" \
        "http://localhost:4443/storage/v1/b?project=${GCP_PROJECT_ID}"
fi

# Keep the container running
tail -f /dev/null 