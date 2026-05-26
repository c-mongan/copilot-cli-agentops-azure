# Security Policy

## Supported Versions

This project is pre-1.0. Security fixes target the current `main` branch.

## Reporting A Vulnerability

Please do not open a public issue for a vulnerability that could expose credentials, telemetry, or private infrastructure details.

Report privately by contacting the repository owner through GitHub. Include:

- affected file or component
- reproduction steps
- impact
- whether secrets, telemetry, or tenant-specific data may be exposed

## Telemetry Safety

The collector and helpers are designed to keep content capture off by default. Before using the project with real workloads:

- confirm `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`
- confirm VS Code Copilot `github.copilot.chat.otel.captureContent=false`
- review collector processors for content-stripping rules
- send telemetry only to destinations approved by your organization
- avoid committing JSONL telemetry exports, screenshots, dashboard exports with real tenant names, or KQL containing production identifiers

## Secrets

Never commit:

- Azure subscription, tenant, or workspace identifiers for private environments
- Application Insights connection strings
- Grafana service account tokens or API keys
- GitHub tokens
- `.env` files
- local MCP configs that reference private servers
- raw Copilot or agent telemetry exports

Use sample files and placeholders in public documentation.
