# Privacy Modes

## Strict

`AGENTOPS_PRIVACY_MODE=strict` is the default.

Strict mode allowlists safe metadata and drops/redacts everything else before export. It also adds `agentops.content_capture.signal=true` when content-like fields are observed, without storing the content.

## Compat

`AGENTOPS_PRIVACY_MODE=compat` uses the older denylist scrubber. It is useful for compatibility testing but is less defensive against unknown future content fields.

## Validate

```bash
agentops collector validate --mode auto --privacy strict --json
agentops collector smoke --privacy strict --poison --json
agentops content status --json
```

The poison smoke test injects synthetic `SECRET_*` fields and checks that strict sanitizing does not emit them.

## Prompt And Response Viewer

Run Replay includes a prompt/response viewer, but strict mode leaves it empty by design. It only renders rows from `AgentOpsContent_CL`, which must be explicitly produced and explicitly allowed for ingestion.

Check the current state with:

```bash
agentops content status --dir .agentops/demo/latest --json
```

Review the opt-in checklist with:

```bash
agentops content opt-in
```

If content rows exist, ingestion remains blocked until the operator passes `--allow-content`:

```bash
agentops azure-ingest plan --dir .agentops/demo/latest --allow-content --json
```

Use content capture only in a restricted workspace with approved viewers and short retention. Shared/default telemetry should keep `AGENTOPS_CAPTURE_CONTENT=false`.

## Collector Processor Artifacts

The strict collector contract is represented as source-controlled fragments under `collector/processors/`:

- `strict-allowlist.yaml`
- `content-signal.yaml`
- `genai-normalizer.yaml`
- `mcp-normalizer.yaml`
- `span-to-run-summary.yaml`

Poison fixtures live under `collector/tests/privacy-poison-fixtures/`. `agentops collector validate` includes an artifact check so missing processor fragments or leaking fixtures fail validation before export.
