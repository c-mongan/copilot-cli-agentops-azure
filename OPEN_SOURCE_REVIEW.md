# Open Source Review Notes

Use this file to prepare a clean review before publishing or using the project in an organization.

## Project Summary

This repository is an independent observability toolkit for Copilot and GenAI agent telemetry. It uses OpenTelemetry, Azure Monitor, Log Analytics, Managed Grafana dashboards, KQL, and local helper scripts.

## Release Positioning

- Independent personal project.
- Not an official Microsoft, GitHub, OpenAI, Azure, or Grafana product.
- Built for public Copilot/OpenTelemetry/Azure Monitor scenarios.
- No confidential information, customer data, or company source code should be included.
- Organization-specific deployment values must stay in ignored local files or private forks.

## Pre-Publish Checks

```bash
npm --prefix agentops-cli test
node scripts/build-grafana-dashboard-pack.js
git diff --check
rg -n "InstrumentationKey|connectionString|Connection String|Bearer |client_secret|AZURE_TENANT_ID|tenantId|subscriptionId|workspaceId|grafana-token|api_key|PRIVATE KEY" .
```

Expected placeholder values include:

- `00000000-0000-0000-0000-000000000000`
- `<workspace-id>`
- `<subscription-id>`
- `rg-agentops-dev`
- `https://<your-grafana>.grafana.azure.com`

## Work Use Notes

If used inside an organization:

- use organization-approved Azure resources
- keep work-specific configs out of the public repo
- do not publish raw telemetry exports
- do not publish private MCP server configs
- do not publish proprietary agent, skill, hook, or script definitions
- follow the organization's open-source and security review process

## Known Commit-Timing Note

Some local development commits may have occurred during weekday working hours. Do not falsify history to hide this. If asked, disclose plainly and follow the appropriate review process.
