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
node agentops-cli/src/index.js alert tune-plan --last 14d --owner agentops-oncall
node agentops-cli/src/index.js alert threshold-patch --rule failed-spans --threshold 1 --owner agentops-oncall --last 14d
node agentops-cli/src/index.js alert policy --owner agentops-oncall --service copilot-agentops --timezone UTC
node agentops-cli/src/index.js alert resources --resource-group "${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
```

`alert tune-plan` turns recommendation and fired-alert history queries into a reviewable threshold-change plan. It does not edit Bicep, enable alerts, or attach action groups.
`alert threshold-patch` turns an approved direct threshold value into a preview-only `infra/bicep/alerts.bicep` diff. It does not edit files and keeps content-capture strict at threshold `0`.
`alert resources` lists current AgentOps scheduled-query rules, whether each rule is enabled, and whether action groups are attached. It is read-only.
`alert policy` prints local metadata for owners, duplicate suppression, quiet-hours placeholders, and manual escalation guardrails. It does not page anyone or create tickets.

Review metadata-only alert history before opening an incident:

```bash
node agentops-cli/src/index.js alert history --rule failed-spans --last 24h
node agentops-cli/src/index.js alert detail --rule failed-spans --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert open --rule failed-spans --session <conversation-id> --last 24h
```

`alert history` returns a KQL query for fired alert candidates by rule. `alert detail` narrows that query to one session and adds the session dashboard/KQL link plus the matching action-plan command. `alert open` prints the session-scoped Run Replay, Runs Explorer, session detail, content-viewer, and Azure Logs links for that alert.

When an alert fires, generate a deterministic issue/work-item plan before notifying anyone:

```bash
node agentops-cli/src/index.js alert action-plan --rule content-capture --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert export --rule content-capture --session <conversation-id> --output .agentops/alerts/content-capture.json --last 24h
node agentops-cli/src/index.js alert handoff --rule content-capture --session <conversation-id> --owner agentops-oncall --output .agentops/alerts/content-capture-handoff.json --last 24h
node agentops-cli/src/index.js alert route-plan --rule content-capture --session <conversation-id> --owner agentops-oncall --target github-issue --output .agentops/alerts/content-capture-route.json --last 24h
node agentops-cli/src/index.js alert route-github --repo <owner/repo> --rule content-capture --session <conversation-id> --owner <github-login> --last 24h
node agentops-cli/src/index.js alert route-azure-devops --org <url> --project <name> --rule content-capture --session <conversation-id> --owner <user> --last 24h
node agentops-cli/src/index.js alert action-group-plan --resource-group <rg> --name ag-agentops-oncall --short-name agentops --owner agentops-oncall --email <address>
node agentops-cli/src/index.js alert route-action-group --resource-group <rg> --scheduled-query <name> --action-group <id> --rule content-capture --session <conversation-id> --owner agentops-oncall --last 24h
node agentops-cli/src/index.js incident timeline --artifact .agentops/alerts/content-capture.json --output .agentops/incidents/content-capture.json
```

The plan, exported artifact, handoff bundle, route-plan payloads, route-github dry-run, route-azure-devops dry-run, action-group-plan preview, route-action-group dry-run, and incident timeline include only safe metadata, KQL, receiver addresses/URLs, and dashboard links. They do not post the issue/work item, create action groups, mutate Azure resources, or include prompts, responses, tool arguments, tool results, or file contents. Add `--yes` to a route command only after reviewing the payload, confirming the owner, and approving the notification destination.

The same evidence is available in the generated `agentops-alert-tuning` Grafana dashboard after rebuilding the dashboard pack:

```bash
node scripts/build-grafana-dashboard-pack.js
```
