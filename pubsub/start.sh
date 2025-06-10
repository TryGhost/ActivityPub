#!/usr/bin/env bash

# This script is used to start the Pub/Sub emulator and create the required
# topic and subscription upfront (defined in the environment variables)
#
# See:
# https://cloud.google.com/pubsub/docs/emulator
# https://cloud.google.com/pubsub/docs/create-topic#pubsub_create_topic-rest
# https://cloud.google.com/pubsub/docs/create-push-subscription#pubsub_create_push_subscription-rest

# Ensure we explicitly set the host to 0.0.0.0:8085 so that the emulator will
# listen on all ip addresses and not just IPv6 (which is the default)
HOST=0.0.0.0:8085

# Start the emulator
gcloud beta emulators pubsub start --host-port=${HOST} --project=${PROJECT_ID} &

# Wait for the emulator to be ready
until curl -f http://${HOST}; do
    echo "Waiting for Pub/Sub emulator to start..."

    sleep 1
done

# Create the topic via REST API
if curl -s -o /dev/null -w "%{http_code}" -X PUT http://${HOST}/v1/projects/${PROJECT_ID}/topics/${FEDIFY_TOPIC_NAME} | grep -q "200"; then
    echo "Topic created: ${FEDIFY_TOPIC_NAME}"
else
    echo "Failed to create topic: ${FEDIFY_TOPIC_NAME}"
    exit 1
fi

# Create the (push) subscription via REST API
if curl -s -o /dev/null -w "%{http_code}" -X PUT http://${HOST}/v1/projects/${PROJECT_ID}/subscriptions/${FEDIFY_SUBSCRIPTION_NAME} \
    -H "Content-Type: application/json" \
    -d '{
  "topic": "projects/'${PROJECT_ID}'/topics/'${FEDIFY_TOPIC_NAME}'",
  "pushConfig": {
    "pushEndpoint": "'${FEDIFY_PUSH_ENDPOINT}'"
  }
}' | grep -q "200"; then
    echo "Subscription created: ${FEDIFY_SUBSCRIPTION_NAME}"
else
    echo "Failed to create subscription: ${FEDIFY_SUBSCRIPTION_NAME}"
    exit 1
fi

# Create the topic via REST API
if curl -s -o /dev/null -w "%{http_code}" -X PUT http://${HOST}/v1/projects/${PROJECT_ID}/topics/${GHOST_TOPIC_NAME} | grep -q "200"; then
    echo "Topic created: ${GHOST_TOPIC_NAME}"
else
    echo "Failed to create topic: ${GHOST_TOPIC_NAME}"
    exit 1
fi

# Create the (push) subscription via REST API
if curl -s -o /dev/null -w "%{http_code}" -X PUT http://${HOST}/v1/projects/${PROJECT_ID}/subscriptions/${GHOST_SUBSCRIPTION_NAME} \
    -H "Content-Type: application/json" \
    -d '{
  "topic": "projects/'${PROJECT_ID}'/topics/'${GHOST_TOPIC_NAME}'",
  "pushConfig": {
    "pushEndpoint": "'${GHOST_PUSH_ENDPOINT}'"
  }
}' | grep -q "200"; then
    echo "Subscription created: ${GHOST_SUBSCRIPTION_NAME}"
else
    echo "Failed to create subscription: ${GHOST_SUBSCRIPTION_NAME}"
    exit 1
fi


# Keep the container running
tail -f /dev/null
