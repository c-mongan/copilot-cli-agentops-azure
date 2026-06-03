# Actioner

The actioner is an opt-in workflow for Azure Monitor alert payloads. The implemented local contract is:

```bash
node agentops-cli/src/index.js alert history --rule <name> --last 24h
node agentops-cli/src/index.js alert detail --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert action-plan --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert export --rule <name> --session <conversation-id> --output .agentops/alerts/<rule>.json --last 24h
node agentops-cli/src/index.js incident timeline --artifact .agentops/alerts/<rule>.json --output .agentops/incidents/<incident>.json
```

The history and detail commands provide metadata-only KQL and session links for alert review. The action-plan command creates a deterministic JSON plan for a GitHub issue or Azure DevOps work item. The export command writes a durable metadata-only alert artifact with:

- alert rule and threshold metadata
- session Grafana link
- session KQL
- threshold evidence KQL
- review guardrails

The incident timeline command collects one or more exported artifacts into a local metadata-only review record. It keeps ownership, ticket, and notes as review placeholders; it does not page anyone or create work items.

It must not call broad LLM tools, read unrelated secrets, mutate Azure resources broadly, or change repository files automatically.
