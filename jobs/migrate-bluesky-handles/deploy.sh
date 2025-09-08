#!/usr/bin/env bash

set -euo pipefail

IMAGE_NAME="migrate-bluesky-handles-job"
JOB_NAME="migrate-bluesky-handles"

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  echo "Error: Could not determine GCP project ID"
  exit 1
fi

REGION=$(gcloud config get-value run/region 2>/dev/null)
if [ -z "$REGION" ]; then
  REGION="us-central1"
fi

echo ""
echo "Building and deploying to GCP..."
echo ""
echo "Project:   $PROJECT_ID"
echo "Region:    $REGION"
echo "Image:     $IMAGE_NAME"
echo "Job Name:  $JOB_NAME"
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

if ! gcloud run jobs create "$JOB_NAME" \
  --image "$IMAGE_URL" \
  --region "$REGION" \
  --network=default \
  --vpc-egress=all-traffic \
  --subnet=default \
  --cpu=1 \
  --memory=1024Mi \
  --max-retries 0; then

  echo ""
  gcloud run jobs update "$JOB_NAME" \
    --image "$IMAGE_URL" \
    --region "$REGION" \
    --network=default \
    --vpc-egress=all-traffic \
    --subnet=default \
    --cpu=1 \
    --memory=1024Mi \
    --max-retries 0;
fi

echo ""
echo "Deployment complete! Job '$JOB_NAME' created/updated"
echo ""
echo "To execute the job, use:"
echo ""
echo "./run.sh <BRIDGY_ACCOUNT_ID>"
