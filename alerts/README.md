# Alerts

Alert rules are defined in `infra/bicep/alerts.bicep` after real Copilot CLI telemetry was verified in `AppDependencies`.

The rules are proposal-only and disabled by default. Deploy them with:

```bash
az deployment group create \
  --resource-group rg-copilot-agentops-dev \
  --template-file infra/bicep/main.bicep \
  --parameters environmentName=dev location=northeurope deployAlerts=true enableAlerts=false
```

Initial rules:

- tool failure spike
- content capture detector
- high AIU usage

Enable rules only after thresholds are tuned against real workload history. No action groups are attached in v0.2.
