# Actioner

The actioner is an opt-in workflow for Azure Monitor alert payloads. The implemented local contract is:

```bash
node agentops-cli/src/index.js alert history --rule <name> --last 24h
node agentops-cli/src/index.js alert detail --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert policy --owner <team-or-person> --service <service-name> --timezone UTC
node agentops-cli/src/index.js alert action-plan --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert export --rule <name> --session <conversation-id> --output .agentops/alerts/<rule>.json --last 24h
node agentops-cli/src/index.js incident timeline --artifact .agentops/alerts/<rule>.json --output .agentops/incidents/<incident>.json
```

The history and detail commands provide metadata-only KQL and session links for alert review. The policy command creates ownership, dedupe, and manual-escalation metadata. The action-plan command creates a deterministic JSON plan for a GitHub issue or Azure DevOps work item. The export command writes a durable metadata-only alert artifact with:

- alert rule and threshold metadata
- session Grafana link
- session KQL
- threshold evidence KQL
- review guardrails

The policy and incident timeline commands keep ownership, ticket, and notes as review placeholders; they do not page anyone or create work items.

It must not call broad LLM tools, read unrelated secrets, mutate Azure resources broadly, or change repository files automatically.
