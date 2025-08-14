#!/bin/sh

# This script starts Redis in cluster mode and initializes a single-node cluster

set -e

# The port to use for the Redis server
PORT=6379

# Get the container's hostname automatically
HOSTNAME=$(hostname)

echo "Starting Redis in cluster mode..."

# Start Redis in cluster mode in the background
redis-server --port ${PORT} --cluster-enabled yes --cluster-announce-ip ${HOSTNAME} --cluster-announce-port ${PORT} --daemonize yes

# Wait for Redis to start
sleep 3

# Initialize cluster with all slots
redis-cli -p ${PORT} cluster addslots $(seq 0 16383)
echo "Redis cluster initialized successfully"

# Stop the background Redis server
redis-cli -p ${PORT} shutdown nosave
sleep 1

# Start Redis in foreground so Docker can manage the process
echo "Starting Redis cluster in foreground..."
exec redis-server --port ${PORT} --cluster-enabled yes --cluster-announce-ip ${HOSTNAME} --cluster-announce-port ${PORT}
