#!/usr/bin/env bash
set -euo pipefail

# Read-only helper for the first-party Application Insights OTLP preview path.
# It prints shell exports only after the exact approved target, OTLP feature,
# managed connection info, and DCR role assignment have all been verified.
#
# Usage:
#   eval "$(AGENTOPS_AZURE_SUBSCRIPTION_ID=<approved-subscription> ./scripts/azure-native-otlp-env.sh)"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/lib/azure-subscription-guard.sh"

subscription_id="${AGENTOPS_AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
location="${AZURE_LOCATION:-northeurope}"
app_insights_name="${AGENTOPS_APPLICATIONINSIGHTS_NAME:-appi-copilot-agentops-dev}"

agentops_require_azure_subscription

if [[ "$(az group exists --name "${resource_group}")" != "true" ]]; then
  echo "ERROR: Azure resource group does not exist: ${resource_group}" >&2
  exit 2
fi

group_location="$(az group show --name "${resource_group}" --query location -o tsv)"
group_location_lower="$(printf '%s' "${group_location}" | tr '[:upper:]' '[:lower:]')"
location_lower="$(printf '%s' "${location}" | tr '[:upper:]' '[:lower:]')"
if [[ "${group_location_lower}" != "${location_lower}" ]]; then
  echo "ERROR: resource group ${resource_group} is in ${group_location}, expected ${location}." >&2
  exit 2
fi

app_id="$(az resource show --resource-group "${resource_group}" --resource-type Microsoft.Insights/components --name "${app_insights_name}" --query id -o tsv 2>/dev/null || true)"
if [[ -z "${app_id}" ]]; then
  echo "ERROR: Application Insights resource not found: ${app_insights_name}" >&2
  exit 2
fi

feature_state="$(az feature show --namespace Microsoft.Insights --name OtlpApplicationInsights --query properties.state -o tsv 2>/dev/null || true)"
if [[ "${feature_state}" != "Registered" ]]; then
  echo "ERROR: Microsoft.Insights/OtlpApplicationInsights is ${feature_state:-unknown}, not Registered." >&2
  exit 2
fi

dcr_resource_id="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.DataCollectionRuleResourceId -o tsv 2>/dev/null || true)"
traces_endpoint="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.OTLPTracesEndpoint -o tsv 2>/dev/null || true)"
logs_endpoint="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.OTLPLogsEndpoint -o tsv 2>/dev/null || true)"
metrics_endpoint="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.OTLPMetricsEndpoint -o tsv 2>/dev/null || true)"

if [[ -z "${dcr_resource_id}" || -z "${traces_endpoint}" || -z "${logs_endpoint}" || -z "${metrics_endpoint}" ]]; then
  echo "ERROR: Application Insights OTLP connection info is incomplete." >&2
  exit 2
fi

case "${dcr_resource_id}" in
  "/subscriptions/${subscription_id}/resourceGroups/"*) ;;
  *) echo "ERROR: OTLP DCR is outside the approved subscription." >&2; exit 2 ;;
esac

principal_id="$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)"
role_id="$(az role definition list --name 'Monitoring Metrics Publisher' --query '[0].id' -o tsv)"
role_count=0
if [[ -n "${principal_id}" && -n "${role_id}" ]]; then
  role_count="$(az role assignment list --scope "${dcr_resource_id}" --assignee-object-id "${principal_id}" --query "length([?roleDefinitionId && contains(roleDefinitionId, '${role_id}')])" -o tsv 2>/dev/null || echo 0)"
fi
if [[ "${role_count}" -lt 1 ]]; then
  echo "ERROR: signed-in identity lacks Monitoring Metrics Publisher on the OTLP DCR." >&2
  exit 2
fi

printf 'export AGENTOPS_AZURE_SUBSCRIPTION_ID=%q\n' "${subscription_id}"
printf 'export AZURE_RESOURCE_GROUP=%q\n' "${resource_group}"
printf 'export AZURE_LOCATION=%q\n' "${location}"
printf 'export AGENTOPS_APPLICATIONINSIGHTS_NAME=%q\n' "${app_insights_name}"
printf 'export AGENTOPS_AZURE_OTLP_DCR_RESOURCE_ID=%q\n' "${dcr_resource_id}"
printf 'export AZURE_MONITOR_OTLP_TRACES_ENDPOINT=%q\n' "${traces_endpoint}"
printf 'export AZURE_MONITOR_OTLP_LOGS_ENDPOINT=%q\n' "${logs_endpoint}"
printf 'export AZURE_MONITOR_OTLP_METRICS_ENDPOINT=%q\n' "${metrics_endpoint}"
