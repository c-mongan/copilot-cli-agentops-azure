# Alerts

Alert rules are defined in `infra/bicep/alerts.bicep` after real Copilot CLI telemetry was verified in `AppDependencies`.

The rules are proposal-only and disabled by default. Deploy them with:

```bash
az deployment group create \
  --resource-group "${AZURE_RESOURCE_GROUP:-rg-agentops-dev}" \
  --template-file infra/bicep/main.bicep \
  --parameters environmentName=dev location=northeurope deployAlerts=true enableAlerts=false
```

Initial rules:

- tool failure spike
- content capture detector
- high AIU usage

Enable rules only after thresholds are tuned against real workload history. No action groups are attached in v0.2.

Use the proposal-only threshold recommender before changing `infra/bicep/alerts.bicep` or setting `enableAlerts=true`:

```bash
node agentops-cli/src/index.js alert recommend --last 14d
```

The same evidence is available in the generated `agentops-alert-tuning` Grafana dashboard after rebuilding the dashboard pack:

```bash
node scripts/build-grafana-dashboard-pack.js
```
