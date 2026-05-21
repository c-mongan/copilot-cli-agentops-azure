#!/usr/bin/env bash
set -euo pipefail

subscription_id="${AZURE_SUBSCRIPTION_ID:-0222a208-955a-45fd-b6d8-ca4704421bf0}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
location="${AZURE_LOCATION:-northeurope}"
environment_name="${AZURE_ENV_NAME:-dev}"
base_name="${AGENTOPS_BASE_NAME:-copilot-agentops}"

az account set --subscription "$subscription_id"

if [[ "$(az group exists --name "$resource_group")" != "true" ]]; then
  cat <<MSG
Resource group ${resource_group} does not exist.
Run the guarded prerequisite script first:

  AGENTOPS_APPROVE_AZURE_CHANGES=yes ./scripts/azure-prereqs.sh
MSG
  exit 2
fi

az deployment group what-if \
  --resource-group "$resource_group" \
  --template-file infra/bicep/main.bicep \
  --parameters environmentName="$environment_name" location="$location" baseName="$base_name"
