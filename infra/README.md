# Infrastructure

This folder contains AZD/Bicep infrastructure for the AgentOps v0.1 skeleton.

## Resources

- Log Analytics Workspace
- Application Insights
- Azure Monitor Workspace
- Azure Managed Grafana
- Key Vault
- Function App placeholder for alert actioner workflows

## Deployment

Do not deploy directly from this scaffold until validation has been run.

```bash
azd provision
```

Run Azure validation first and confirm subscription/location before any provisioning.
