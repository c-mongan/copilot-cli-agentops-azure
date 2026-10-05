# Copilot CLI compatibility and failed-run browser audit

Date: 30 September 2026. Source checkout: `551506a` plus the uncommitted reference-order/model requirements in the master plan. Installed executable: `/opt/homebrew/bin/copilot`; `copilot version` reports **1.0.89**. Scope: local help, source inspection, a synthetic round-trip probe, and browser replay of a retained failed synthetic Copilot run. No new model task, Azure query/upload/deployment, dependency install, or product-code repair was performed.

## Verdict and evidence boundaries

The existing capture and viewer provide a useful failed-run investigation path. They do not yet meet the complete forensic contract for ordered reference delivery, requested versus actual models, per-request token/cache usage, or complete correlation. The installed CLI exposes useful native telemetry, but current web documentation and local help differ; supported capabilities must be pinned to producer versions and tested against actual receipts.

This audit replays an existing CLI run; it is not a fresh end-to-end execution test. The native input was previously reconstructed from historical Azure-shaped metadata, not preserved raw native OTLP. That reconstruction lacks model/token attributes, so the browser cannot prove those attributes were absent from the original CLI execution. No current Azure state is inferred from the replay.

## Installed CLI versus documentation

`copilot help monitoring` confirms opt-in OTel, HTTP JSON/protobuf and file export, agent/model/tool span hierarchy, native subagent context propagation, extra resource attributes, and optional message/tool content capture. It lists `gen_ai.client.inference.operation.input_tokens` and `.output_tokens`, usage counters including cache/reasoning, and `gen_ai.execute_tool.duration`. The current web reference also lists older/different metric shapes such as `gen_ai.client.token.usage`. Record actual emitted signal names before defining dashboard queries.

The installed help documents a relevant failure condition: inherited OTel TLS certificate/client-certificate settings with an HTTP endpoint can disable export while the agent continues. The warning can be confined to process logs or suppressed by log level. Setup must detect incompatible inherited settings and validate receipt arrival rather than treating a running agent as proof of collection. This behavior was read in local help, not exercised in a fresh run.

The web reference documents requested and response model identities, input/output/cache tokens, time to first chunk, skill-invocation and compaction/truncation events, and gated full message/tool content. It states that `github.copilot.cost` is a billing multiplier, not currency, and warns against counting root and child AI-unit totals together. The documented `github.copilot.nano_aiu` spelling differs from fields retained in current collector configs (`github.copilot.aiu.nano` and older names); actual 1.0.89 raw receipt coverage remains to be established.

Skill documentation confirms that activation injects `SKILL.md`; other bundled files are available, not necessarily read. Hook documentation distinguishes successful tool completion from failure, and exposes final subagent responses before spill handling. Any adapter must be passive and preserve agent decisions. These are documentation capabilities, not fresh installed-version hook proofs.

Sources: [CLI monitoring reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring), [skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli), [hooks](https://docs.github.com/en/copilot/reference/hooks-reference), and [MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers). Local help was saved with the audit artifacts.

## Confirmed source and round-trip gaps

| Finding | Evidence | Required acceptance/repair |
| --- | --- | --- |
| Requested/actual model conflated | `session-otel.js` chooses response model or falls back to request model into one `model` field; span export/storage uses one `Model` column. | Preserve requested and actual identities independently through capture, ledger, Azure, reload and UI; missing actual identity remains unavailable. |
| Token counts lost on ledger reload | `spanRowsFromOtelSpans` exports input/output counts, but `readSessionSpanRows` does not restore them. Synthetic probe exported 123/45, reloaded null/null. | Restore available usage and test export/reload/render parity. Existing passing tests do not cover this requirement. |
| Missing usage represented as zero | Span export converts absent/non-numeric usage into 0. | Distinguish unavailable usage from a measured zero with a backward-compatible representation. |
| Cache and provider detail incomplete | OTLP parser projection and span ledger omit separate cache counts/provider and requested/actual model fields; flattened reload cannot recover omitted data. | Define the additive fields and preserve them end to end; do not derive per-skill usage from aggregate counts. |
| Strict allowlists diverge | Binary strict config retains `gen_ai.tool.call.id`; shared strict fragment omits it. Native agent identity, timing/context-event attributes and newer AI-unit keys are not consistently retained. | Audit the active configs separately; allowlist only reviewed metadata, and test native source → sanitizer → export preservation. Do not loosen strict content policy. |
| Reference coverage is bounded | Export recognizes attachment-declared references through supported file-read tools and restricted direct `cat`; compound shell commands and undeclared resources are excluded. Owning-skill association can be inferred/ambiguous. | Prove ordered multi-reference reads, rereads, failed attempts, version identity and concurrent lanes; show unsupported reference loaders explicitly. Reuse existing reference rows. |
| Context metrics need source preservation | Span-event reload restores skill names but not arbitrary safe compaction/truncation attributes. | Preserve reviewed context metadata before implementing context-pressure findings. |

Synthetic token proof and local monitoring help are in `/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-compat-audit-Z8XonA/`. The token probe called the current exporter and reader without altering product source or emitting telemetry.

## Real browser review of the retained failed run

Run: `wrapper_run_d75a06c58700eed7`; session: `8ce8d14d-e9b3-4326-959f-2a709ce15db8`. Re-rendered with the current CLI from retained session events and `azure-spans-as-otel.jsonl`, from the original attached fixture working directory. The output is `compat-audit-current-20260930.html` beside the retained receipts under `scratch/copilot-home.xUxYuN/session-state/<session-id>/`. Content viewing was enabled only for this known synthetic fixture; no content was uploaded.

An isolated `agent-browser` session (`agentops-compat-20260930`, CLI 0.37.1, launched Chrome for Testing) opened the page without attaching to a personal browser. Browser interactions verified:

- 69 operation rows; 23 exact-session native spans, one run-linked script span, ten exact tool joins, and two failure cards.
- Failed Bash and Python-script details, `fixture-inspector` subagent lane, and the existing MCP call.
- Failures filter selected and reduced the visible timeline to two rows.
- The script's inferred related-tool link opened the matching Bash row and made it visible even under the failure filter.
- A session model-change label showed `gpt-5.6-sol`; this does not prove the model used for every request/subagent.
- At 390 × 844, document width remained 390 px with no horizontal overflow. Desktop review also exercised 1440 × 1000. Screenshots were visually inspected; console and page-error commands returned no entries.

Limits and UX findings:

- This fixture read the script `fail.py`, not a declared reference; zero `reference.read` rows is expected. It does not close reference-order acceptance.
- Restored span input has no model/token attributes. The view lacks the dedicated per-request requested/actual-model and usage presentation required by the master plan.
- The reconstructed metadata retains an integer 0 ms failed-script duration; missing historical precision cannot be repaired by rendering it again.
- Summary reports zero algorithmic coverage gaps while delivery evidence is not observed and model/reference requirements remain unproved. Label the gap count's denominator/scope prominently; zero counted gaps must not imply full forensic coverage.
- The summary shows zero inferred script/tool links while the failure card offers an inferred related-tool link. Define whether these count persisted edges or renderer-derived associations and make the wording consistent.
- Raw JSON/error payloads are readable and links work, but lengthy cards dominate the view. Add a concise interpreted summary and progressive detail before calling the UI polished.

Screenshots: `compat-audit-desktop.png` and `compat-audit-mobile.png` beside the generated HTML. The review proves one retained synthetic failed-run replay, not fresh Azure delivery or enterprise readiness.

## Next acceptance package

1. Capture a fresh synthetic 1.0.89 receipt with multiple declared references, rereads, a failed read, model requests/switches and a delegated worker; retain raw native signals and local ledger separately. Use narrow permissions and record every expected boundary before launch.
2. Repair model/usage preservation and strict metadata mapping with round-trip and privacy regression tests; preserve existing reference/subagent/script-step implementations and architecture-owner files.
3. Verify reference sequence and concurrent lanes, model identities, non-double-counted usage, and explicitly unavailable fields in the rendered flow. Test telemetry failure/TLS misconfiguration without changing task behavior.
4. Verify same-run Azure schema/readback only in the existing explicitly selected synthetic target under its authorization; hosted schema application is separate from this documentation audit.

The capture owner owns these repairs. The architecture engine may continue against fixtures, but metrics depending on missing model/context/reference evidence must remain unavailable or insufficient-evidence until their producer contracts pass.
