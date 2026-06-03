# Actioner

The actioner is an opt-in workflow for Azure Monitor alert payloads. The implemented local contract is:

```bash
node agentops-cli/src/index.js alert history --rule <name> --last 24h
node agentops-cli/src/index.js alert detail --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert action-plan --rule <name> --session <conversation-id> --last 24h
```

The history and detail commands provide metadata-only KQL and session links for alert review. The action-plan command creates a deterministic JSON plan for a GitHub issue or Azure DevOps work item with:

- alert rule and threshold metadata
- session Grafana link
- session KQL
- threshold evidence KQL
- review guardrails

It must not call broad LLM tools, read unrelated secrets, mutate Azure resources broadly, or change repository files automatically.
