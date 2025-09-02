#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/deploy-cloudrun.sh PROJECT_ID [REGION] [SERVICE_NAME]
PROJECT_ID=${1:-}
REGION=${2:-us-central1}
SERVICE_NAME=${3:-seek-api}

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: $0 PROJECT_ID [REGION] [SERVICE_NAME]" >&2
  exit 1
fi

gcloud config set project "${PROJECT_ID}"
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --port 8080


