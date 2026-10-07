# Changelog

All notable changes to this project are recorded here. This is a preview
project. Package versions stay at `0.1.0` until a package is published to npm.

## Unreleased

### Fixed

- **One cost estimate for the UI and digest.** `agentops ui` and `agentops
  digest` used two different price tables: the digest's 2025 table had 8 models,
  so current models were unpriced and a week of runs showed $0.30, while the UI
  priced the same models and showed $217. Both now use one dated table and
  estimator (`agentops-cli/src/lib/cost-estimate.js`) and compute the same total
  for the same runs. Unpriced models show "n/a", never $0 or a guess, and totals
  read `$X est. (N models unpriced)` in both. `GET /api/runs?since=7d` matches the
  digest window.
- **`agentops ui latest` opens the run you just launched.** `latest` now prefers
  the newest AgentOps ledger run or finished session, and picks a still-running
  Copilot session only when nothing else exists. `agentops open latest --ui`
  uses the same rule.
- `copilot-session launch --json` now writes only the JSON document to stdout. The Copilot transcript goes to stderr, so `launch --json | jq .` works.
- A permission-denied tool call no longer marks a run `failed`. Launch, `copilot-session view` and the local UI share one status classifier: failures (tool calls Copilot reports as failed, failed hooks and sub-agents, or a Copilot run error) give `failed`; denials and non-zero shell exits give the new `attention` status ("Needs attention"). See [How run status is decided](docs/local-ui.md#how-run-status-is-decided).
- Span counts are reconciled and labelled. Launch, view and the UI report the same deduplicated native OTel span count. Launch also reports span-table rows, and the UI also reports trace spans, each with its own label.

### Added

- `launch --json` adds `status`, `statusLabel`, `statusReasons`, `signals` and `spanCounts`. `view --json` adds `status`, `status_label`, `status_reasons`, `signals` and `native_spans_label`. UI run rows add `denials`, `nonZeroExits`, `nativeSpans`, `traceSpans` and `statusLabel`. Existing fields are unchanged.

## v0.3.0-preview: 2026-10-07

### Added

- **Local web UI.** `agentops ui` (also `agentops ui latest` and `agentops open
  latest --ui`) serves a zero-dependency, read-only, metadata-only web UI on
  127.0.0.1. It shows a runs list with KPIs and filters, and a per-run span
  waterfall with a failure callout, cumulative token and estimated-cost meter,
  and per-tool latency. First graph in about 2 s with no Azure or Docker. See
  [docs/local-ui.md](docs/local-ui.md) (#180).
- **Pipeline doctor.** `agentops doctor` prints a six-stage ready / warning /
  blocked checklist (Copilot CLI, native OTel capture, local Collector, local
  ledger, local report, Azure publishing) with a fix command for each stage. JSON output gains a
  backward-compatible `pipeline` section (#176).
- **OpenTelemetry GenAI export.** `copilot-session export-otel` re-emits a
  captured session as standard `gen_ai.*` spans (semantic conventions pinned to
  1.41.0), metadata only, to an OTLP endpoint, Application Insights or a file, so
  runs appear in the Application Insights Agents (preview) view. See
  [docs/otel-genai.md](docs/otel-genai.md) (#177).
- **Weekly digest.** `agentops digest --since 7d` clusters failures by tool,
  error type and model, lists slow tools and token trends, and writes Markdown,
  HTML or JSON. See [docs/digest.md](docs/digest.md) (#178).
- **Portable Grafana dashboard.** `grafana/agentops-copilot-cli.json` imports
  into Azure Monitor dashboards with Grafana, Azure Managed Grafana or
  self-hosted Grafana. See [docs/grafana.md](docs/grafana.md) (#179).
- **Deploy to Azure.** A one-click, metadata-only template
  (`infra/azuredeploy.json`) with a 1 GB/day ingestion cap and a monthly budget
  alert. See [docs/deploy-to-azure.md](docs/deploy-to-azure.md) (#181).

### Fixed

- `copilot-session view` no longer shows a stale note about Architecture and
  Compare views.
- Test fixtures moved to the OS temp directory, which removes parallel and
  Windows CI flakes (#182).

### Known limits

- Copilot CLI does not report cost; cost figures are estimates from public
  per-token list prices and are labelled as such.
- `azd up` for the template is documented but not yet verified.
- The package is not on the npm registry; install from the release tarball.

## v0.2.1-preview: 2026-10-07

### Fixed

- `agentops copilot-session launch -- -p "..."` with no `--model` or tool
  flags (the README quickstart) no longer exits 1 with "supplied execution
  configuration identity must be ... hash" after Copilot finishes (#174).

### Added

- One-command install: the release attaches the packed CLI tarball
  (`copilot-agentops-cli-0.1.0.tgz`), CycloneDX SBOMs, `release-manifest.json`
  and `SHA256SUMS`, so `npx -p <release tarball URL> agentops ...` works
  without cloning or a global install.

## v0.2.0-preview: 2026-10-07

The first preview since `v0.1.0-preview`. It covers 211 commits.

### Highlights

- **Native Copilot CLI capture.** `agentops copilot-session launch` runs Copilot
  with native OpenTelemetry behind a scoped, strict, loopback-only Collector. It
  writes a local run ledger and can optionally publish metadata to Azure with
  `--upload --yes`.
- **Local run view.** `agentops copilot-session view` renders a metadata-only
  HTML report. It shows failure signals with their preceding context, an
  end-to-end timeline, model provenance, and token use per request.
- **Azure ingestion.** A reviewed Logs Ingestion upload workflow uses a Data
  Collection Rule to write `AgentOpsEvents_CL` and `AgentOpsSpans_CL` in Log
  Analytics. A V2 ingestion Bicep module provisions it. Publishing is capped at
  0 bytes per day unless you set a cap explicitly.
- **Azure Workbook.** A tabbed diagnostic Workbook covers runs, tool failures,
  usage and trace lineage. Trace lineage now shows native span events (#171).
- **VS Code native capture extension.** It publishes native metadata to Azure
  and verifies the cloud readback by exact event ID (#168, #170).
- **Enterprise flight recorder.** This preview adds a local product build
  (Runs, Architecture, Compare and evidence receipts) and the Azure diagnostic
  skills (#167).

### Fixes and hardening

- Pinned the Azure MCP startup package to the reviewed 2.0.5 release (#169).
- Azure writes fail closed. They need an approved subscription allowlist and an
  explicit target.
- Benchmark runs use a container network sandbox, approver gates and
  fixture-trust rotation and revocation.

### Documentation

- The README is now a short landing page with a demo GIF, the architecture
  diagram, a 3-step quickstart and the privacy defaults. The full command
  reference moved to `docs/operator-guide.md`.
- Added the Copilot CLI E2E walkthrough to `docs/e2e-validation.md`: 3 real
  sessions, Azure readback that matched local row counts exactly, and tokens
  that matched Copilot CLI's own summary.

### Known limits

- Copilot CLI 1.0.93 emits no cost metadata, so estimated cost is empty for
  native runs.
- A shell command that exits non-zero is recorded as a successful tool span.
  The local session event still records the failure.
- Each native tool span is stored twice in `AgentOpsSpans_CL`.
- The Workbook usage panels read run summaries, which native launch-only runs
  do not produce.

## v0.1.0-preview: 2026-05-27

The initial public preview.
