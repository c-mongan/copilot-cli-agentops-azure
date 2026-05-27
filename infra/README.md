# Infrastructure

This folder contains AZD/Bicep infrastructure for the AgentOps v0.1 skeleton.

## Resources

- Log Analytics Workspace
- Application Insights
- Azure Monitor Workspace
- Azure Managed Grafana
- Key Vault
- Optional Function App placeholder for alert actioner workflows
- Optional Entra group RBAC assignments
- Optional resource-group monthly budget

## Deployment

Do not deploy directly from this scaffold until validation has been run.

```bash
azd provision
```

Run Azure validation first and confirm subscription/location before any provisioning.

For an internal pilot, review:

- `docs/enterprise-pilot.md`
- `docs/threat-model.md`
