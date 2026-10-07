# Changelog

All notable changes to this project are recorded here. This is a preview
project. Package versions stay at `0.1.0` until a package is published to npm.

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
