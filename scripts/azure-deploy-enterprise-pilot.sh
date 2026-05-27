#!/usr/bin/env bash
set -euo pipefail

subscription_id="${AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
location="${AZURE_LOCATION:-northeurope}"
environment_name="${AZURE_ENV_NAME:-dev}"
base_name="${AGENTOPS_BASE_NAME:-copilot-agentops}"
deployment_name="${AGENTOPS_DEPLOYMENT_NAME:-agentops-enterprise-pilot}"
deployment_profile="${AGENTOPS_DEPLOYMENT_PROFILE:-team}"
log_retention_days="${AGENTOPS_LOG_RETENTION_DAYS:-0}"
daily_ingestion_cap_gb="${AGENTOPS_DAILY_INGESTION_CAP_GB:-0}"
deploy_rbac_assignments="${AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS:-false}"
observer_principal_ids="${AGENTOPS_OBSERVER_PRINCIPAL_IDS:-[]}"
operator_principal_ids="${AGENTOPS_OPERATOR_PRINCIPAL_IDS:-[]}"
admin_principal_ids="${AGENTOPS_ADMIN_PRINCIPAL_IDS:-[]}"
deploy_budget="${AGENTOPS_DEPLOY_BUDGET:-false}"
monthly_budget_amount="${AGENTOPS_MONTHLY_BUDGET_AMOUNT:-100}"
budget_contact_emails="${AGENTOPS_BUDGET_CONTACT_EMAILS:-[]}"

if [[ -n "$subscription_id" ]]; then
  az account set --subscription "$subscription_id"
fi

if ! az group exists --name "$resource_group" -o tsv | grep -q true; then
  az group create --name "$resource_group" --location "$location" >/dev/null
fi

az deployment group create \
  --name "$deployment_name" \
  --resource-group "$resource_group" \
  --template-file infra/bicep/main.bicep \
  --parameters environmentName="$environment_name" location="$location" baseName="$base_name" deploymentProfile="$deployment_profile" logRetentionDays="$log_retention_days" dailyIngestionCapGb="$daily_ingestion_cap_gb" deployRbacAssignments="$deploy_rbac_assignments" observerPrincipalIds="$observer_principal_ids" operatorPrincipalIds="$operator_principal_ids" adminPrincipalIds="$admin_principal_ids" deployBudget="$deploy_budget" monthlyBudgetAmount="$monthly_budget_amount" budgetContactEmails="$budget_contact_emails"

cat <<MSG
Enterprise pilot deployment completed for resource group: $resource_group

Next:
  az deployment group show --resource-group "$resource_group" --name "$deployment_name" --query properties.outputs
  agentops configure import-azd  # if this resource group was originally provisioned by azd
  agentops validate-azure
  agentops smoke --wait 2m --poll 10s
MSG
