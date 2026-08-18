# Infrastructure

This folder contains AZD/Bicep infrastructure for the AgentOps developer-preview.

## Resources

- Log Analytics Workspace
- Application Insights
- Optional Azure Monitor Workspace, Azure Managed Grafana, and Key Vault
- Optional Function App placeholder for alert actioner workflows
- Optional Entra group RBAC assignments
- Optional resource-group monthly budget

## Deployment

The default deployment is deliberately small: Log Analytics plus Application
Insights for the native Azure Monitor Agents experience. Grafana, Azure
Monitor Workspace, and Key Vault are advanced services and are disabled unless
`deployAdvancedServices=true` is explicitly supplied.

Do not deploy directly from this scaffold until validation has been run.

For the explicit, smallest deployment path, review and then run the guarded
helper with both approval flags:

```bash
AGENTOPS_APPROVE_AZURE_CHANGES=yes AGENTOPS_CONFIRM_MINIMAL_DEPLOY=yes \
  AGENTOPS_AZURE_SUBSCRIPTION_ID="<approved-subscription-id>" \
  AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS="<approved-subscription-id>" \
  ./scripts/azure-minimal-deploy.sh
```

The helper always sets `deployAdvancedServices=false`; durable receipt tables
are separately opt-in with `AGENTOPS_DEPLOY_V2_INGESTION=true`.

```bash
azd provision
```

Run Azure validation first and confirm subscription/location before any provisioning.

For an internal pilot, review:

- `docs/enterprise-pilot.md`
- `docs/azure-production-hardening.md`
- `docs/threat-model.md`
