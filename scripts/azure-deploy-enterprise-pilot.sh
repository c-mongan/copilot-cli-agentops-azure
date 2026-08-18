#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/lib/azure-subscription-guard.sh"

subscription_id="${AGENTOPS_AZURE_SUBSCRIPTION_ID:-}"
resource_group="${AZURE_RESOURCE_GROUP:-rg-copilot-agentops-dev}"
location="${AZURE_LOCATION:-northeurope}"
environment_name="${AZURE_ENV_NAME:-dev}"
base_name="${AGENTOPS_BASE_NAME:-copilot-agentops}"
deployment_name="${AGENTOPS_DEPLOYMENT_NAME:-agentops-enterprise-pilot}"
deployment_profile="${AGENTOPS_DEPLOYMENT_PROFILE:-team}"
deploy_advanced_services="${AGENTOPS_DEPLOY_ADVANCED_SERVICES:-true}"
log_retention_days="${AGENTOPS_LOG_RETENTION_DAYS:-0}"
daily_ingestion_cap_gb="${AGENTOPS_DAILY_INGESTION_CAP_GB:-0}"
deploy_alerts="${AGENTOPS_DEPLOY_ALERTS:-false}"
enable_alerts="${AGENTOPS_ENABLE_ALERTS:-false}"
alert_action_group_resource_ids="${AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS:-[]}"
grafana_public_network_access="${AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS:-Enabled}"
grafana_zone_redundancy="${AGENTOPS_GRAFANA_ZONE_REDUNDANCY:-Disabled}"
deploy_rbac_assignments="${AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS:-false}"
observer_principal_ids="${AGENTOPS_OBSERVER_PRINCIPAL_IDS:-[]}"
operator_principal_ids="${AGENTOPS_OPERATOR_PRINCIPAL_IDS:-[]}"
admin_principal_ids="${AGENTOPS_ADMIN_PRINCIPAL_IDS:-[]}"
deploy_budget="${AGENTOPS_DEPLOY_BUDGET:-false}"
monthly_budget_amount="${AGENTOPS_MONTHLY_BUDGET_AMOUNT:-100}"
budget_contact_emails="${AGENTOPS_BUDGET_CONTACT_EMAILS:-[]}"

if [[ "${AGENTOPS_APPROVE_AZURE_CHANGES:-}" != "yes" || "${AGENTOPS_CONFIRM_ENTERPRISE_DEPLOY:-}" != "yes" ]]; then
  cat <<MSG
No Azure changes were made.

This deployment is guarded to the explicitly configured subscription and
reviewed AgentOps target. To approve the resource
group/deployment write, rerun with both flags and explicit subscription:

  AGENTOPS_APPROVE_AZURE_CHANGES=yes AGENTOPS_CONFIRM_ENTERPRISE_DEPLOY=yes \\
    AGENTOPS_AZURE_SUBSCRIPTION_ID="<approved-subscription-id>" \\
    ./scripts/azure-deploy-enterprise-pilot.sh
MSG
  exit 2
fi

agentops_require_azure_subscription

if ! az group exists --name "$resource_group" -o tsv | grep -q true; then
  az group create --name "$resource_group" --location "$location" >/dev/null
fi

az deployment group create \
  --name "$deployment_name" \
  --resource-group "$resource_group" \
  --template-file infra/bicep/main.bicep \
  --parameters environmentName="$environment_name" location="$location" baseName="$base_name" deploymentProfile="$deployment_profile" deployAdvancedServices="$deploy_advanced_services" logRetentionDays="$log_retention_days" dailyIngestionCapGb="$daily_ingestion_cap_gb" deployAlerts="$deploy_alerts" enableAlerts="$enable_alerts" alertActionGroupResourceIds="$alert_action_group_resource_ids" grafanaPublicNetworkAccess="$grafana_public_network_access" grafanaZoneRedundancy="$grafana_zone_redundancy" deployRbacAssignments="$deploy_rbac_assignments" observerPrincipalIds="$observer_principal_ids" operatorPrincipalIds="$operator_principal_ids" adminPrincipalIds="$admin_principal_ids" deployBudget="$deploy_budget" monthlyBudgetAmount="$monthly_budget_amount" budgetContactEmails="$budget_contact_emails"

cat <<MSG
Enterprise pilot deployment completed for resource group: $resource_group

Next:
  az deployment group show --resource-group "$resource_group" --name "$deployment_name" --query properties.outputs
  agentops configure import-azd  # if this resource group was originally provisioned by azd
  agentops validate-azure
  agentops smoke --wait 2m --poll 10s
MSG
