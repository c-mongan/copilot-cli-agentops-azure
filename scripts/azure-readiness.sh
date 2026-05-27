#!/usr/bin/env bash
set -euo pipefail

subscription_id="${AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"

if [[ -n "$subscription_id" ]]; then
  az account set --subscription "$subscription_id"
fi
az account show --query '{name:name,id:id,tenantId:tenantId,user:user.name}' -o table

for ns in Microsoft.OperationalInsights Microsoft.Insights Microsoft.Monitor Microsoft.Dashboard Microsoft.KeyVault Microsoft.Web Microsoft.Storage; do
  if ! az provider show --namespace "$ns" --query '{namespace:namespace, registrationState:registrationState}' -o tsv; then
    printf '%s\t%s\n' "$ns" 'LookupFailed'
  fi
done

printf 'resourceGroup\t%s\texists\t%s\n' "$resource_group" "$(az group exists --name "$resource_group")"
