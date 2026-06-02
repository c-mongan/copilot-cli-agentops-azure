# LLM Map

This file is a compact map for coding agents working in this repository.

## Product Contract

Copilot AgentOps for Azure is a privacy-first observability control room for Copilot CLI, Copilot SDK, VS Code/MCP tooling, and GitHub code outcomes.

Never break these invariants:

- strict privacy mode is the default;
- raw prompts, responses, source code, file contents, tool arguments, tool results, system instructions, request bodies, response bodies, full URLs, and secrets are not captured by default;
- the local OpenTelemetry Collector is the scrub-before-export boundary;
- no-collector mode requires explicit unsafe opt-in;
- V2 dashboards are the default product experience;
- legacy dashboards are debug views, not the main product.

## System Flow

```text
User
  -> Copilot CLI / SDK / VS Code MCP
  -> AgentOps wrapper, SDK adapter, or MCP proxy
  -> OTLP localhost:4318
  -> strict collector processors
  -> Azure Monitor / Log Analytics
  -> Grafana V2 dashboards
  -> replay, explain, triage, recommend
```

## Data Flow

```text
Span metadata
  -> normalize GenAI + MCP attributes
  -> drop or redact content-like fields
  -> emit privacy signal rows
  -> roll up Agent Run tables
  -> query with KQL
  -> dashboard drilldowns
```

## Repository Map

```text
agentops-cli/src/index.js
  command router

agentops-cli/src/commands/
  CLI command wrappers

agentops-cli/src/lib/
  product logic and testable helpers

agentops-cli/src/lib/collector-artifacts.js
  static collector processor, config, and poison fixture validation

collector/
  OpenTelemetry Collector configs and privacy processors

grafana/dashboards/v2/
  default AgentOps for Azure dashboards

grafana/kql/
  V2 dashboard query library

docs/
  product docs, architecture, privacy, schema, setup, and validation

packages/agentops-copilot-sdk/
  Copilot SDK adapter

examples/
  safe examples and smoke fixtures
```

## High-Value Files

- `README.md`: short product entry point.
- `docs/README.md`: docs index.
- `docs/architecture.md`: system architecture and ASCII diagrams.
- `docs/agent-run-data-model.md`: V2 table and run model.
- `docs/otel-genai-mcp-schema.md`: OTel mapping.
- `docs/grafana-dashboard-tour-v2.md`: operator tour.
- `docs/release-checklist-v2.md`: verification matrix.
- `agentops-cli/test/index.test.js`: broad product behavior tests.
- `agentops-cli/test/commands.test.js`: command-wrapper tests.
- `agentops-cli/test/core-helpers.test.js`: focused helper tests.

## Safe Edit Guidance

Prefer small changes in these zones:

- command wrapper behavior: `agentops-cli/src/commands/<name>.js`
- reusable logic: `agentops-cli/src/lib/<area>/`
- tests: `agentops-cli/test/*.test.js`
- dashboard JSON generation: `scripts/build-grafana-v2-dashboard-pack.js`
- generated dashboard output: `grafana/dashboards/v2/*.json`
- docs: `docs/*.md`

Avoid broad rewrites of:

- `agentops-cli/src/legacy.js`
- generated dashboard JSON unless updating the generator too;
- collector privacy allowlists without matching poison tests.

## Verification Commands

Fast checks:

```bash
npm --prefix agentops-cli test
npm --prefix agentops-cli run coverage:check
npm --prefix agentops-cli run static:check
node agentops-cli/src/index.js schema validate
```

Privacy checks:

```bash
node agentops-cli/src/index.js collector validate --mode auto --privacy strict --json
node agentops-cli/src/index.js collector smoke --privacy strict --poison --json
```

Dashboard checks:

```bash
node agentops-cli/src/index.js dashboard validate
node agentops-cli/src/index.js dashboard links-check
node agentops-cli/src/index.js dashboard ux-check
node agentops-cli/src/index.js dashboard verify
```

Demo data checks:

```bash
node agentops-cli/src/index.js demo generate --runs 50 --with-failures --with-privacy-drops --with-github-outcomes --json
node agentops-cli/src/index.js demo verify --runs 50 --json
```

## Coverage State

The current enforced line coverage gate is 80%.

Next good targets:

- improve `collector-manager.js` with tests around binary/Docker planning and validation errors;
- improve command modules with direct wrapper tests;
- split legacy behavior into smaller helper modules only when a testable extraction is obvious.

## Common Mistakes To Avoid

- Do not store prompt/response text in default fixtures.
- Do not add dashboard panels that query raw content fields by default.
- Do not claim MCP proxy or policy hooks are a sandbox.
- Do not make V1/legacy dashboards the default import path.
- Do not add Azure mutations to commands that are documented as plan/dry-run.
- Do not put repo names, file paths, prompts, or code in metric labels.

## Product Shape

```text
Home
  -> Runs Explorer
  -> Run Replay
  -> Tools & MCP Risk
  -> Models, Cost & Tokens
  -> Safety, Privacy & Policy
  -> Code Outcomes
  -> Evals & Quality
  -> Insights & Regressions
  -> Collector Health
```

The user experience should feel like an AgentOps control room, not a pile of traces.
