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

Default telemetry is intended to be metadata only: run/session IDs, operation names, tool names, model names, timings, status, token/cost fields, hashed repo labels, and agent/skill/MCP/script labels. Prompts, responses, source code, file contents, tool arguments, tool results, system instructions, request bodies, response bodies, and full URLs should not be collected unless a user deliberately enables scoped capture for a trusted local or approved environment.

If you enable content capture for debugging, scope it narrowly with `AGENTOPS_CAPTURE_CONTENT_AGENTS` or `AGENTOPS_CAPTURE_CONTENT_SKILLS`, keep retention short, and disable it again before using shared or production workloads.

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

## Public Release Hygiene

Before publishing a fork or release:

- run the checks in `docs/public-release.md`
- publish from a fresh export or reviewed branch
- replace live Azure resource names with placeholders
- regenerate or remove screenshots that show tenant, user, repo, prompt, code, or resource identifiers
- keep benchmark runs, telemetry exports, `.env` files, and local MCP configs out of Git
