#!/usr/bin/env bash

set -euo pipefail

IMAGE_NAME="reconcile-account-topics-job"

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  echo "Error: Could not determine GCP project ID"
  exit 1
fi

echo ""
echo "Building and pushing to GCP..."
echo ""
echo "Project: $PROJECT_ID"
echo "Image:   $IMAGE_NAME"
echo ""

echo "Building Docker image..."
echo ""
docker build --platform linux/amd64 -t "$IMAGE_NAME" .
echo ""

IMAGE_URL="gcr.io/$PROJECT_ID/$IMAGE_NAME:latest"
echo "Tagging image: $IMAGE_URL"
docker tag "$IMAGE_NAME" "$IMAGE_URL"
echo ""

echo "Pushing image to Google Container Registry..."
echo ""
docker push "$IMAGE_URL"
echo ""

echo ""
echo "Push complete!"
echo ""
echo "Built and pushed image to '$IMAGE_URL'"
echo ""
