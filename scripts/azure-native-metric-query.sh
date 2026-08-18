#!/usr/bin/env bash
set -euo pipefail

# Query one metadata-only metric emitted through the native Application
# Insights OTLP path. Azure Monitor Workspace metrics are queried through its
# Prometheus-compatible endpoint; `az monitor metrics list` is for platform
# resource metrics and is not the right surface for these OTel series.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/lib/azure-subscription-guard.sh"

subscription_id="${AGENTOPS_AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
app_insights_name="${AGENTOPS_APPLICATIONINSIGHTS_NAME:-appi-copilot-agentops-dev}"
smoke_id="${AGENTOPS_SMOKE_ID:-}"
metric_name="${AGENTOPS_METRIC_NAME:-agentops.metric}"

agentops_require_azure_subscription

if [[ -z "${smoke_id}" ]]; then
  echo "ERROR: set AGENTOPS_SMOKE_ID to the metric smoke correlation ID." >&2
  exit 2
fi
if [[ ! "${smoke_id}" =~ ^[A-Za-z0-9_.:-]+$ ]]; then
  echo "ERROR: AGENTOPS_SMOKE_ID contains unsupported query characters." >&2
  exit 2
fi
if [[ ! "${metric_name}" =~ ^[A-Za-z0-9_.:-]+$ ]]; then
  echo "ERROR: AGENTOPS_METRIC_NAME contains unsupported query characters." >&2
  exit 2
fi

app_id="$(az resource show --resource-group "${resource_group}" --resource-type Microsoft.Insights/components --name "${app_insights_name}" --query id -o tsv 2>/dev/null || true)"
if [[ -z "${app_id}" ]]; then
  echo "ERROR: Application Insights resource not found: ${app_insights_name}" >&2
  exit 2
fi

amw_id="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.AzureMonitorWorkspaceResourceId -o tsv 2>/dev/null || true)"
if [[ -z "${amw_id}" ]]; then
  echo "ERROR: Application Insights does not expose an Azure Monitor Workspace." >&2
  exit 2
fi

query_endpoint="$(az resource show --ids "${amw_id}" --api-version 2025-10-03-preview --query properties.metrics.prometheusQueryEndpoint -o tsv 2>/dev/null || true)"
if [[ -z "${query_endpoint}" ]]; then
  echo "ERROR: Azure Monitor Workspace Prometheus query endpoint is unavailable." >&2
  exit 2
fi

token="$(az account get-access-token --resource https://prometheus.monitor.azure.com --query accessToken -o tsv)"
query="{\"${metric_name}\",\"agentops.custom_event_id\"=\"${smoke_id}\"}"

curl --fail --silent --show-error --get \
  --data-urlencode "query=${query}" \
  --header "Authorization: Bearer ${token}" \
  "${query_endpoint}/api/v1/query"
