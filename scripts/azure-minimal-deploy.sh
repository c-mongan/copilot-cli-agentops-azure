#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
source "${script_dir}/lib/azure-subscription-guard.sh"

subscription_id="${AGENTOPS_AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
location="${AZURE_LOCATION:-northeurope}"
environment_name="${AZURE_ENV_NAME:-dev}"
base_name="${AGENTOPS_BASE_NAME:-copilot-agentops}"
deployment_name="${AGENTOPS_DEPLOYMENT_NAME:-agentops-minimal}"
deploy_v2_ingestion="${AGENTOPS_DEPLOY_V2_INGESTION:-false}"

cat <<MSG
AgentOps minimal Azure deployment target:
  subscription: ${subscription_id:-<missing>}
  resource group: ${resource_group}
  location: ${location}
  advanced services: false
  durable receipt ingestion: ${deploy_v2_ingestion}
MSG

if [[ "${AGENTOPS_APPROVE_AZURE_CHANGES:-}" != "yes" || "${AGENTOPS_CONFIRM_MINIMAL_DEPLOY:-}" != "yes" ]]; then
  cat <<MSG

No Azure changes were made.
This guarded command creates or updates only the approved minimal AgentOps
path: Log Analytics and Application Insights, with optional durable receipt
tables when AGENTOPS_DEPLOY_V2_INGESTION=true. Grafana, Azure Monitor
Workspace, and Key Vault remain disabled.

After reviewing the target above, rerun with both explicit approvals:

  AGENTOPS_APPROVE_AZURE_CHANGES=yes AGENTOPS_CONFIRM_MINIMAL_DEPLOY=yes \\
    AGENTOPS_AZURE_SUBSCRIPTION_ID="<approved-subscription-id>" \\
    ./scripts/azure-minimal-deploy.sh
MSG
  exit 2
fi

: "${subscription_id:?Set AGENTOPS_AZURE_SUBSCRIPTION_ID before any Azure write.}"
agentops_require_azure_subscription

if [[ "$(az group exists --name "${resource_group}" --subscription "${subscription_id}")" != "true" ]]; then
  az group create \
    --name "${resource_group}" \
    --location "${location}" \
    --subscription "${subscription_id}" \
    --tags app=copilot-cli-agentops-azure environment="${environment_name}" telemetryContent=metadata-only \
    --only-show-errors >/dev/null
fi

az deployment group what-if \
  --name "${deployment_name}-whatif" \
  --resource-group "${resource_group}" \
  --subscription "${subscription_id}" \
  --template-file "${repo_root}/infra/bicep/main.bicep" \
  --parameters environmentName="${environment_name}" location="${location}" baseName="${base_name}" \
    deployAdvancedServices=false deployV2Ingestion="${deploy_v2_ingestion}" \
  --no-pretty-print

az deployment group create \
  --name "${deployment_name}" \
  --resource-group "${resource_group}" \
  --subscription "${subscription_id}" \
  --template-file "${repo_root}/infra/bicep/main.bicep" \
  --parameters environmentName="${environment_name}" location="${location}" baseName="${base_name}" \
    deployAdvancedServices=false deployV2Ingestion="${deploy_v2_ingestion}" \
  --only-show-errors

cat <<MSG

Minimal AgentOps Azure deployment completed.
Next:
  agentops configure import-azd
  agentops validate-azure --last 24h --json
  agentops smoke --real-copilot --wait 2m --poll 10s --json
MSG
