#!/usr/bin/env bash
set -euo pipefail

subscription_id="${AZURE_SUBSCRIPTION_ID:-0222a208-955a-45fd-b6d8-ca4704421bf0}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
app_insights_name="${APPLICATIONINSIGHTS_NAME:-appi-copilot-agentops-dev}"

az account set --subscription "$subscription_id"

export APPLICATIONINSIGHTS_CONNECTION_STRING="$(az monitor app-insights component show \
  --resource-group "$resource_group" \
  --app "$app_insights_name" \
  --query connectionString \
  -o tsv)"

if [[ -z "$APPLICATIONINSIGHTS_CONNECTION_STRING" ]]; then
  echo "Application Insights connection string lookup returned an empty value." >&2
  exit 1
fi

docker compose -f collector/docker-compose.azuremonitor.yaml up -d --force-recreate

cat <<MSG
Azure Monitor collector started on 127.0.0.1:4318 and 127.0.0.1:4317.
Connection string was retrieved at runtime and not written to disk.

Check status:
  docker compose -f collector/docker-compose.azuremonitor.yaml ps

Stop it:
  docker compose -f collector/docker-compose.azuremonitor.yaml down
MSG