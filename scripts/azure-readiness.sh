#!/usr/bin/env bash
set -euo pipefail

subscription_id="${AZURE_SUBSCRIPTION_ID:-0222a208-955a-45fd-b6d8-ca4704421bf0}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"

az account set --subscription "$subscription_id"
az account show --query '{name:name,id:id,tenantId:tenantId,user:user.name}' -o table

for ns in Microsoft.OperationalInsights Microsoft.Insights Microsoft.Monitor Microsoft.Dashboard Microsoft.KeyVault Microsoft.Web Microsoft.Storage; do
  if ! az provider show --namespace "$ns" --query '{namespace:namespace, registrationState:registrationState}' -o tsv; then
    printf '%s\t%s\n' "$ns" 'LookupFailed'
  fi
done

printf 'resourceGroup\t%s\texists\t%s\n' "$resource_group" "$(az group exists --name "$resource_group")"
