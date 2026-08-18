#!/usr/bin/env bash
set -euo pipefail

# Read-only gate for the native Application Insights OTLP preview path.
# It deliberately does not register features, create resource groups, assign
# roles, run what-if, or deploy anything.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/lib/azure-subscription-guard.sh"

subscription_id="${AGENTOPS_AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
location="${AZURE_LOCATION:-northeurope}"
app_insights_name="${AGENTOPS_APPLICATIONINSIGHTS_NAME:-appi-copilot-agentops-dev}"
dcr_resource_id="${AGENTOPS_AZURE_OTLP_DCR_RESOURCE_ID:-}"

agentops_require_azure_subscription

if [[ "$(az group exists --name "${resource_group}")" != "true" ]]; then
  cat <<MSG
native_otlp_readiness: blocked
subscription: ${subscription_id}
resource_group: ${resource_group}
expected_location: ${location}
application_insights: ${app_insights_name}
reason: configured target resource group does not exist
write_intent: false

No Azure changes were made. Confirm the exact target before using the guarded
prerequisite/deployment workflows.
MSG
  exit 2
fi

group_location="$(az group show --name "${resource_group}" --query location -o tsv)"
app_id="$(az resource show --resource-group "${resource_group}" --resource-type Microsoft.Insights/components --name "${app_insights_name}" --query id -o tsv 2>/dev/null || true)"
feature_state="$(az feature show --namespace Microsoft.Insights --name OtlpApplicationInsights --query properties.state -o tsv 2>/dev/null || true)"

# The first-party OTLP onboarding stores the connection-info values on the
# Application Insights resource. Discover them here so a junior operator does
# not need to transcribe long Azure URLs by hand. The values are endpoints and
# resource IDs, not bearer credentials.
discovered_dcr_resource_id=""
traces_endpoint=""
logs_endpoint=""
metrics_endpoint=""
if [[ -n "${app_id}" ]]; then
  discovered_dcr_resource_id="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.DataCollectionRuleResourceId -o tsv 2>/dev/null || true)"
  traces_endpoint="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.OTLPTracesEndpoint -o tsv 2>/dev/null || true)"
  logs_endpoint="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.OTLPLogsEndpoint -o tsv 2>/dev/null || true)"
  metrics_endpoint="$(az resource show --ids "${app_id}" --api-version 2020-02-02 --query properties.OTLPMetricsEndpoint -o tsv 2>/dev/null || true)"
fi

if [[ -z "${dcr_resource_id}" ]]; then
  dcr_resource_id="${discovered_dcr_resource_id}"
fi

cat <<MSG
native_otlp_readiness: discovered
subscription: ${subscription_id}
resource_group: ${resource_group}
actual_location: ${group_location}
expected_location: ${location}
application_insights: ${app_insights_name}
application_insights_id: ${app_id:-NOT_FOUND}
otlp_application_insights_feature: ${feature_state:-UNKNOWN}
write_intent: false
MSG

group_location_lower="$(printf '%s' "${group_location}" | tr '[:upper:]' '[:lower:]')"
location_lower="$(printf '%s' "${location}" | tr '[:upper:]' '[:lower:]')"
if [[ "${group_location_lower}" != "${location_lower}" ]]; then
  echo "gate: FAIL location mismatch" >&2
  exit 2
fi
if [[ -z "${app_id}" ]]; then
  echo "gate: FAIL Application Insights resource not found" >&2
  exit 2
fi
if [[ "${feature_state}" != "Registered" ]]; then
  echo "gate: FAIL OtlpApplicationInsights feature is not Registered" >&2
  exit 2
fi

if [[ -z "${dcr_resource_id}" || -z "${traces_endpoint}" || -z "${logs_endpoint}" || -z "${metrics_endpoint}" ]]; then
  cat <<MSG
gate: PENDING
next: finish first-party OTLP onboarding and confirm the resource exposes its
DCR resource ID plus traces/logs/metrics endpoints.
MSG
  exit 2
fi

case "${dcr_resource_id}" in
  "/subscriptions/${subscription_id}/resourceGroups/"*) ;;
  *)
    echo "gate: FAIL DCR resource ID is not in the approved subscription" >&2
    exit 2
    ;;
esac

role_id="$(az role definition list --name 'Monitoring Metrics Publisher' --query '[0].id' -o tsv)"
principal_id="$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)"
role_count=0
if [[ -n "${principal_id}" && -n "${role_id}" ]]; then
  role_count="$(az role assignment list --scope "${dcr_resource_id}" --assignee-object-id "${principal_id}" --query "length([?roleDefinitionId && contains(roleDefinitionId, '${role_id}')])" -o tsv 2>/dev/null || echo 0)"
fi

cat <<MSG
dcr_resource_id: ${dcr_resource_id}
signed_in_principal_id: ${principal_id:-UNKNOWN}
monitoring_metrics_publisher_assignments: ${role_count}
gate: $([[ "${role_count}" -gt 0 ]] && echo PASS || echo FAIL)
traces_endpoint: ${traces_endpoint}
logs_endpoint: ${logs_endpoint}
metrics_endpoint: ${metrics_endpoint}
write_intent: false
MSG

[[ "${role_count}" -gt 0 ]]
