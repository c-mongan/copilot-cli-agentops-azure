# Copilot CLI Instrumentation

AgentOps observes GitHub Copilot CLI through a local privacy boundary.

```text
agentops copilot
  -> starts/validates local collector
  -> resolves the real Copilot CLI, not the AgentOps shim
  -> launches copilot-observe
  -> exports OTLP to http://127.0.0.1:4318
```

## Safe Defaults

`agentops copilot` defaults to:

- `AGENTOPS_PRIVACY_MODE=strict`;
- `AGENTOPS_COLLECTOR_MODE=auto`;
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`;
- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`.

It does not silently run without a collector. `--collector-mode none` requires `--unsafe-no-collector` or `AGENTOPS_ALLOW_NO_COLLECTOR=1`.

## What Is Captured

Captured metadata:

- run/session IDs;
- model and mode;
- operation names;
- tool names;
- tool risk buckets;
- exit status and failures;
- latency and token/cost fields when emitted by Copilot;
- hashed repo, workspace, command, and prompt identifiers.

Not captured by default:

- raw prompts;
- raw responses;
- source code or file contents;
- tool arguments;
- tool results;
- system instructions;
- request/response bodies;
- full URLs;
- secrets.

## Helper Modules

The Copilot CLI capture helpers live under `agentops-cli/src/lib/copilot/`:

- `resolve-real-copilot.js`: resolves the real Copilot binary while rejecting AgentOps shims.
- `run-metadata.js`: creates hashed run metadata from CLI args.
- `session-parser.js`: groups OTel rows into sessions.
- `tool-classifier.js`: maps tool names to risk buckets.
- `run-summary.js`: creates metadata-only run summaries.

## Validate

```bash
agentops collector validate --mode auto --privacy strict --json
agentops collector smoke --privacy strict --poison --json
agentops copilot --no-ask-user --no-remote --add-dir . --allow-tool='shell(pwd)' -p 'Do not edit files. Run pwd.'
agentops latest --last 2h
agentops replay latest --last 2h
```

Use `agentops dashboard kql-check --last 24h --json` after Azure ingestion to verify the dashboard queries still work.
