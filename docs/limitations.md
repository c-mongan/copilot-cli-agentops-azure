# Limitations and evidence notes

Caveats that used to sit in the README. They apply to the current developer preview.

## Known limits

- Cost is an estimate from public list prices, not billed cost. Models without a published price show "n/a" and are left out of totals. Azure cost comes from runtime cost metadata only; current Copilot CLI builds emit none, so it is usually empty.
- Copilot CLI records a shell command that exits non-zero as a successful tool span. AgentOps reads the exit code (metadata only) from the session events and tags that span `shell_nonzero_exit`. The run is marked `attention`, not `failed`. Every surface (launch, UI, digest, export-otel) reports "Failed tool calls" for errored tool calls only and "Needs attention" for denials and non-zero exits; see [How run status is decided](local-ui.md#how-run-status-is-decided).
- Before v0.3.2, each native tool span was stored twice in `AgentOpsSpans_CL`. v0.3.2 deduplicates by trace and span ID before upload, but Logs Ingestion is at-least-once and older rows remain, so keep counting by `SpanId` or by `chat` operations, not by raw rows.
- Token totals must come from `chat` spans or the shutdown event. Summing every span row over-counts.
- The Azure Workbook reads usage from run summaries, so native-only runs show usage as "partial or unknown".
- Not a hosted service, a governance platform or a security boundary. Hooks, benchmarks and advanced dashboards are experimental.


## Cost figures

Estimated cost uses public list prices (local UI and `digest`); `EstimatedCostUsd` in Azure is nullable. It is an estimate, not billed cost: Copilot CLI 1.0.93 reports no cost and bills premium requests. The UI and `digest` use the shared price estimator; missing or partial prices are labelled rather than treated as zero. Azure cost stays empty.

## Evidence behind the README claims (real Copilot CLI, 2026-10-07)

| Question | Result |
|---|---|
| Which tool call failed or was denied? | A denied `curl` appears as a failure signal |
| Where did the time go? | A 12 s shell step reads back as 12,109 ms |
| How many tokens did each model call use? | Tokens match Copilot CLI's own summary |
| Did Azure store exactly what was sent? | Local and Azure row counts matched for all 3 runs |

Walkthrough: [CLI E2E validation, 2026-10-07](e2e-validation.md#copilot-cli-walkthrough-2026-10-07).

## v0.3.5 release demo

The [34-second v0.3.5 release demo](https://github.com/c-mongan/copilot-cli-agentops-azure/releases/download/v0.3.5-preview/agentops-v0.3.5-e2e.mp4) shows actual Copilot CLI and shell execution, native capture, failure diagnosis, operator repair and a successful rerun ([evidence](https://github.com/c-mongan/copilot-cli-agentops-azure/releases/download/v0.3.5-preview/evidence.json)). It uses a deterministic local model provider, does not demonstrate Azure delivery or assess model quality, and is separate from the generated sample-data demo in the README.

## Comparison with other tools

Azure Monitor already has coding-agent dashboards, and Aspire can show standard traces locally. AgentOps focuses on a Copilot CLI run and its session-event context. It has not been shown to outperform those tools in a comparative user test. See [when to use AgentOps](product-scope.md) for the alternatives, deployment needs and evidence limits.
