#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID before running scripts/azure-prereqs.sh}"
subscription_id="$AZURE_SUBSCRIPTION_ID"
resource_group="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
location="${AZURE_LOCATION:-northeurope}"

cat <<MSG
Target Azure context:
  subscription: ${subscription_id}
  resource group: ${resource_group}
  location: ${location}
MSG

if [[ "${AGENTOPS_APPROVE_AZURE_CHANGES:-}" != "yes" ]]; then
  cat <<MSG

This script registers providers and creates a resource group.
To approve these Azure changes, rerun with:

  AGENTOPS_APPROVE_AZURE_CHANGES=yes ./scripts/azure-prereqs.sh
MSG
  exit 2
fi

az account set --subscription "$subscription_id"
az provider register --namespace Microsoft.Monitor
az provider register --namespace Microsoft.Dashboard
az group create --name "$resource_group" --location "$location" --tags app=copilot-cli-agentops-azure environment=dev

az provider show --namespace Microsoft.Monitor --query '{namespace:namespace, registrationState:registrationState}' -o table
az provider show --namespace Microsoft.Dashboard --query '{namespace:namespace, registrationState:registrationState}' -o table
az group show --name "$resource_group" --query '{name:name, location:location, provisioningState:properties.provisioningState}' -o table
