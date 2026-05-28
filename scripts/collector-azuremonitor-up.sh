#!/usr/bin/env bash
set -euo pipefail

subscription_id="${AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
app_insights_name="${APPLICATIONINSIGHTS_NAME:-appi-agentops-dev}"
privacy_mode="${AGENTOPS_PRIVACY_MODE:-strict}"
export AGENTOPS_PRIVACY_MODE="${privacy_mode}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
collector_dir="${repo_root}/collector"
compose_file="${collector_dir}/docker-compose.azuremonitor.yaml"

if [[ -n "$subscription_id" ]]; then
  az account set --subscription "$subscription_id"
fi

export APPLICATIONINSIGHTS_CONNECTION_STRING="$(az monitor app-insights component show \
  --resource-group "$resource_group" \
  --app "$app_insights_name" \
  --query connectionString \
  -o tsv)"

if [[ -z "$APPLICATIONINSIGHTS_CONNECTION_STRING" ]]; then
  echo "Application Insights connection string lookup returned an empty value." >&2
  exit 1
fi

docker compose \
  --project-name agentops-azuremonitor \
  --project-directory "${collector_dir}" \
  -f "${compose_file}" \
  up -d --force-recreate

cat <<MSG
Azure Monitor collector started on 127.0.0.1:4318 and 127.0.0.1:4317.
Privacy mode: ${privacy_mode}.
Connection string was retrieved at runtime and not written to disk.

Check status:
  docker compose --project-name agentops-azuremonitor --project-directory "${collector_dir}" -f "${compose_file}" ps

Stop it:
  docker compose --project-name agentops-azuremonitor --project-directory "${collector_dir}" -f "${compose_file}" down
MSG
