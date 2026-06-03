# Actioner

The actioner is an opt-in workflow for Azure Monitor alert payloads. The implemented local contract is:

```bash
node agentops-cli/src/index.js alert history --rule <name> --last 24h
node agentops-cli/src/index.js alert detail --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert tune-plan --last 14d --rule <name> --owner <team-or-person>
node agentops-cli/src/index.js alert policy --owner <team-or-person> --service <service-name> --timezone UTC
node agentops-cli/src/index.js alert action-plan --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert export --rule <name> --session <conversation-id> --output .agentops/alerts/<rule>.json --last 24h
node agentops-cli/src/index.js alert handoff --rule <name> --session <conversation-id> --owner <team-or-person> --output .agentops/alerts/<rule>-handoff.json --last 24h
node agentops-cli/src/index.js alert route-plan --rule <name> --session <conversation-id> --owner <team-or-person> --target github-issue --output .agentops/alerts/<rule>-route.json --last 24h
node agentops-cli/src/index.js alert route-github --repo <owner/repo> --rule <name> --session <conversation-id> --owner <github-login> --last 24h
node agentops-cli/src/index.js incident timeline --artifact .agentops/alerts/<rule>.json --output .agentops/incidents/<incident>.json
```

The history and detail commands provide metadata-only KQL and session links for alert review. The tune-plan command creates a proposal-only threshold-change artifact with Bicep patch targets and validation queries. The policy command creates ownership, dedupe, and manual-escalation metadata. The action-plan command creates a deterministic JSON plan for a GitHub issue or Azure DevOps work item. The export command writes a durable metadata-only alert artifact. The handoff command bundles the alert detail, tune-plan, policy, resource-state placeholder, and incident timeline into one operator review packet with:

- alert rule and threshold metadata
- session Grafana link
- session KQL
- threshold evidence KQL
- ownership and escalation guardrails
- review guardrails

The route-plan command turns that safe handoff context into preview-only GitHub Issue or Azure DevOps Work Item payloads. The route-github command is dry-run by default and only creates a GitHub issue when `--yes` is passed with a repo and owner. The tune-plan, policy, handoff, route-plan, and incident timeline commands keep remediation as review placeholders; they do not edit alert thresholds, enable rules, page anyone, post payloads, or create work items.

It must not call broad LLM tools, read unrelated secrets, mutate Azure resources broadly, or change repository files automatically.
