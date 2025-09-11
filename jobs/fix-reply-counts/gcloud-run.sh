#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
JOB_NAME="fix-reply-counts"

REGION=$(gcloud config get-value run/region 2>/dev/null)
if [ -z "$REGION" ]; then
  REGION="europe-west4"
fi

echo "Executing GCP Cloud Run Job..."
echo ""
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Job name: $JOB_NAME"
echo ""

gcloud run jobs execute "$JOB_NAME" \
  --region "$REGION"
