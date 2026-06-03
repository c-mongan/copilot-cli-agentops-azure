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

Enable rules only after thresholds are tuned against real workload history. Action groups must be passed explicitly.

Use the proposal-only threshold recommender before changing `infra/bicep/alerts.bicep` or setting `enableAlerts=true`:

```bash
node agentops-cli/src/index.js alert recommend --last 14d
```

Review metadata-only alert history before opening an incident:

```bash
node agentops-cli/src/index.js alert history --rule failed-spans --last 24h
node agentops-cli/src/index.js alert detail --rule failed-spans --session <conversation-id> --last 24h
```

`alert history` returns a KQL query for fired alert candidates by rule. `alert detail` narrows that query to one session and adds the session dashboard/KQL link plus the matching action-plan command.

When an alert fires, generate a deterministic issue/work-item plan before notifying anyone:

```bash
node agentops-cli/src/index.js alert action-plan --rule content-capture --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert export --rule content-capture --session <conversation-id> --output .agentops/alerts/content-capture.json --last 24h
node agentops-cli/src/index.js incident timeline --artifact .agentops/alerts/content-capture.json --output .agentops/incidents/content-capture.json
```

The plan, exported artifact, and incident timeline include only safe metadata, KQL, and dashboard links. They do not create the issue, mutate Azure resources, or include prompts, responses, tool arguments, tool results, or file contents.

The same evidence is available in the generated `agentops-alert-tuning` Grafana dashboard after rebuilding the dashboard pack:

```bash
node scripts/build-grafana-dashboard-pack.js
```
