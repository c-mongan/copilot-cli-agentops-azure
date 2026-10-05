# Ponytail complexity audit: Copilot AgentOps

Date: 2026-10-02. Source HEAD: `0b91a3671376f9bc655aa955094d995ac711254c`.

**Verdict:** The recorder's distinctive value is execution evidence, trustworthy component attribution, private run reconstruction and controlled before/after evaluation. The largest complexity reduction is to make that one product explicit and move the historical dashboard/hosted assistant/evaluation platform out of its default distribution and onboarding. There is no evidence here that the core privacy, delivery or coverage machinery should be removed.

This applies the installed Ponytail `ponytail-audit` and `ponytail-review` skills. It is a read-only review of source, followed by this report; no product files were changed. Repository inventory is complete, but manual inspection concentrated on the runtime entry points, asset packaging, dashboard generators, hosted actioner/judge, event/span/SDK/Vally exporters and their callers. This is not a claim that every source line was reviewed. Nothing was deployed, uploaded or model-run.

> 🧠 **From Hindsight memory (AgentOps waterfall reference reads)** — The historical evidence contract distinguishes exact, logical, inferred, ambiguous, missing, unsupported and unknown observations, and retains repeated reads and unknown coverage. Current plans and source corroborate that these distinctions belong to the product and must survive simplification. Historical test counts were not used as current proof.

## Measured shape

Counts are tracked source files at the cited HEAD, excluding untracked reports and reference checkouts. They measure maintenance surface, not removable code.

| Surface | Measured size | Why it matters |
|---|---:|---|
| Tracked repository files | 838 | Broad product/platform surface |
| CLI source files | 255 | Many operator workflows beyond capture |
| CLI test files | 139 | Safeguards and compatibility contracts; retain |
| Repository scripts | 42 | Installation, deployment, packaging and dashboard build operations |
| Grafana files | 37 | Two historical dashboard generations and provisioning |
| Declared core / experimental command names | 42 / 35 | A broad public mental model even after experimental segregation |
| Legacy runtime | 951 lines | Eagerly loaded by the current entry point |
| Raw-OTel / V2 dashboard generators | 941 / 1,029 lines | Independent queries, UI definitions and maintenance |
| Hosted actioner entry point | 1,396 lines | Another operator/recommendation interface |

The CLI manifest has **no runtime dependencies**. The SDK declares an optional Copilot SDK peer. Removing a small helper by adding an npm dependency would work against the present design. No dependency saving is demonstrated.

## Ranked Ponytail findings

1. `yagni:` Cut the all-in-one default CLI distribution. Replace it with a reviewed recorder asset allowlist and an explicitly optional advanced evidence pack. [`agentops-cli/package.json`, `scripts/prepare-cli-package-assets.js`]
2. `native:` Cut the requirement to build a full AgentOps dashboard platform before obtaining useful native traces. Reuse the selected native viewer for standard trace inspection; retain local Runs/Architecture evidence for questions native spans do not answer. [`docs/architecture.md`, `docs/azure-native-otlp-preview.md`, `grafana/`]
3. `yagni:` Cut hosted actioner/shared-store completion from the recorder's finish criteria. Replace the default hosted assistant/editor/review workflow with the existing local metadata context and recommendation packet. [`actioner/index.js`, `agentops-cli/src/lib/triage-packet.js`, `infra/bicep/main.bicep`]
4. `yagni:` Cut two competing evaluation stacks from the default value loop. Use Vally for the declared trial/compare workflow; retain legacy benchmark fixtures and adapters as compatibility support until their needed isolation and anti-cheat features have proven equivalents. [`agentops-cli/src/lib/benchmark-*.js`, `benchmark-judges/`, `benchmark-runners/`, `evals/stockpilot/`]
5. `shrink:` Cut repeated command metadata and eager loading of every historical subsystem. Use one command descriptor table for routing, help and visibility, with explicit compatibility dispatch. [`agentops-cli/src/index.js`, `agentops-cli/src/lib/cli-dispatch.js`, `agentops-cli/src/lib/cli-surface.js`, `agentops-cli/src/lib/legacy-runtime.js`]
6. `shrink:` Cut parallel ledger loading conventions. Keep one evidence-reader contract for production artifacts with explicit adapters for fixture and Vally layouts. [`agentops-cli/src/lib/architecture-command.js`, `agentops-cli/src/lib/copilot/session-span-export.js`, `evals/stockpilot/scripts/export-agentops-ledger.js`]
7. `shrink:` Cut drift in shared field projection rules, not the source-specific exporters. Reuse a small pure metadata contract for nullable measurements, stable identities and schema fields, while preserving event/span/Vally provenance. [`agentops-cli/src/lib/copilot/session-event-export.js`, `agentops-cli/src/lib/copilot/session-span-export.js`, `packages/agentops-copilot-sdk/src/event-envelope.js`, `evals/stockpilot/scripts/export-agentops-ledger.js`]
8. `yagni:` Cut broad runtime support from the initial acceptance matrix. Ship a versioned, explicitly supported Node/Python execution surface first; keep TypeScript/JSX declarations and unsupported evidence visible until each loader has parity proof. [`agentops-cli/src/lib/attach-command.js`, `instrumentation/`, `docs/plans/2026-09-30-agentops-overnight-build.md`]

These are ranked simplification proposals, not approved deletions. None is classified as proven dead code.

## What those cuts actually require

### 1. Slim distribution without breaking installation

`prepare-cli-package-assets.js` copies actioner, judges, runners, collector, Copilot assets, docs, examples, fixtures, Grafana, infra, instrumentation, KQL, SDK packages, plugin and scripts into the CLI package. Its prepack/postpack machinery also owns cleanup and locking. Those operations are currently part of package lifecycle correctness; removing them independently is unsafe.

First define a smallest install that can discover prerequisites, attach a project, launch a scoped run, collect/retain a receipt, open a metadata-only waterfall, inspect coverage and analyze architecture. Derive assets from that call graph. Put advanced dashboard and hosted control-plane assets behind a separately selected profile. Preserve existing release/install/package-lifecycle checks, then test the actual resulting tarball in an isolated install. `paths.js` supports both source-repository and packaged layouts, so the package structure itself is a compatibility contract.

### 2. Native viewer reuse has a strict limit

The existing architecture document already names Application Insights Agents as the default path and Grafana as optional. README and native-preview documentation also retain an explicit connection-string/custom Logs Ingestion compatibility lane. Keeping optional Grafana is coherent; requiring every historical dashboard to finish the recorder is not.

The raw-OTel generator uses App* tables while the V2 generator uses custom AgentOps tables. They are not interchangeable duplicates. A candidate retirement must check actual deployed dashboards, table consumers and migration support. The companion [current platform research](2026-10-02-current-platform-research.md) verifies that native Copilot exposes inference/tool/subagent spans and Application Insights supplies agent/model/tool/token views. This strengthens the case for retiring generic duplicate panels after deployed-consumer review. [GitHub monitoring contract](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring), [Microsoft Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)

Aspire's current documentation includes SQLite persistence and historical runs, increasing overlap with generic local trace browsing. Its short-term development durability and conflicting older documentation mean it is a candidate viewer, not a proven replacement for the private evidence ledger. Test the selected release's persistence, retention and privacy before substitution. Azure native OTLP remains preview and cannot simply replace the compatibility route's acceptance evidence. [Aspire persistence](https://aspire.dev/dashboard/data-persistence/), [Azure preview limits](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/collect-use-observability-data)

Native trace viewers do not by themselves prove attachment inventory, declared references, ordered rereads, skill attribution, unsupported shell reads, lifecycle completeness or architecture findings. Those are the reason to retain the local evidence product. Replacing that product with a generic waterfall would remove its differentiator.

### 3. Hosted assistant work is optional, not dead

`main.bicep` defaults `deployAdvancedServices`, `deployActioner`, `deploySharedStore`, `deployV2Ingestion` and `deployAlerts` to false. Actioner contains actual shared metadata editing, context hydration, recommendation review and guarded apply-packet generation. `buildGuardedRecommendationApply()` has callers in the actioner's response/launch builders. Its returned packet states it does not edit repositories or deploy infrastructure; it is not an implemented autonomous refactoring engine.

The local `buildTriage()` already combines replay links, `buildV2AskContext()` and `recommendFromFiles()`. Reuse that evidence as the ordinary review handoff. Keep hosted collaboration as a separate initiative with its own user and acceptance criteria. If subsequently retired, preserve metadata exports and approval/evidence guardrails; do not move automatic apply into the CLI as a replacement.

### 4. Converge eval orchestration while retaining protection

The September 30 plan explicitly selects Vally and prohibits a second evaluation harness. The repository nevertheless retains a legacy benchmark context/execution/report stack, hosted judge wrapper/service/template and runner infrastructure. A hosted judge additionally introduces service operations and paid-provider choices that the zero-budget recorder proof does not need.

Do not blindly delete legacy benchmark protections: sealed fixtures, signed fixture packs, controlled commands, forbidden-file checks, isolation and anti-cheat policy can matter. Inventory which protection each current Vally task actually provides. Reuse or port the necessary protection into the selected trial workflow, keep deterministic graders where sufficient, and postpone hosted semantic judging until the question requires it. No claim of evaluation-stack parity follows from fixture tests alone.

### 5. Simplify dispatch after preserving supported behavior

`src/index.js` imports legacy immediately. `ask-context-command.js` and `v2-ask-context.js` also reference legacy helpers, so lazily importing only `index.js` would not fully remove the dependency. Core/experimental lists, direct-handler maps, exported entry-point functions and long help text repeat command facts across files. Some command routing deliberately changes with flags: `recommend --runs` uses the V2 path while other calls fall back to legacy.

One descriptor table can own name, visibility, help, aliases and loader. Keep explicit flag-dependent compatibility routing rather than hiding it in a generic abstraction. The benefit is fewer inconsistent definitions and a smaller first-run surface; performance improvement is not measured here. Retain backward-compatible aliases and focused help. Nine dispatch/surface tests passed in this audit and describe behavior a future change must preserve.

### 6–7. One evidence contract, several honest projections

The architecture loader now accepts both fixture `attachment.json`/`context.json`/`events.jsonl` and real repository attachment plus `run-context.json`/`AgentOpsEvents_CL.jsonl`. It already delegates manifest ownership checks to `readOwnedAttachment()` and span interpretation to `readSessionSpanRows()`. Its bounded regular-file/non-symlink handling should not be replaced with the simpler unbounded `json.js` helper just to save lines.

Events, native spans, SDK ordered events and Vally trajectories describe different observations. The SDK OTLP exporter has real callers in SDK client construction, public exports, examples and tests. The span ledger reader has consumers in architecture, run delivery, session commands and investigation queries. Neither is dead. Different delivery paths also have different acknowledgement semantics: SDK in-memory OTLP acceptance and durable per-run Azure outbox/readback are not equivalent retry wrappers.

The worthwhile consolidation is a pure row contract and explicit artifact reader: nullable token/count conversion, safe identifiers, schema version and known field names. It must preserve Vally's `evidenceComplete:false`, unknown coverage and source tier, native span links and exact event sequence. Do not manufacture native trace spans from Vally trajectory observations merely to make the schema uniform.

### 8. Narrow support commitments, keep discovery honest

Attachment discovery lists Python, JavaScript, JSX, TypeScript and TSX variants. The runtime profile already separates declared, observed and verified support and warns that TypeScript loader compatibility requires proof. An inventory entry is useful even for an unsupported runtime. The simplification is to narrow the release promise and test matrix first, not to hide unsupported scripts or remove gap reporting. Node/Python root spans and explicitly instrumented internal steps remain distinct evidence.

## Recommended product boundary

```text
scoped Copilot session + owned script/MCP evidence
                         |
                  strict local boundary
                         |
           one private run ledger + lifecycle receipt
                    /                  \
          Runs / Architecture       optional metadata export
                    |                  |
          hypothesis + Vally        Azure native / advanced pack
                    |
           operator review of a measured change
```

Keep process supervision, private artifact ownership/permissions, strict metadata allowlists, content-canary tests, stable IDs, accepted-versus-readback evidence, unknown coverage, run/session isolation, safe HTML rendering and at least the smoke/regression checks. Those functions make the evidence usable; their line count is not a reason to cut them.

## Verification and limits

- Reused the existing Graphify graph with `GRAPHIFY_QUERY_LOG_DISABLE=1` and read-only `affected` queries for `architectureCommand`, `readSessionSpanRows`, `createOtlpJsonExporter` and `buildGuardedRecommendationApply`; verified the relevant relationships in source. The graph was not refreshed and its freshness was not asserted. Absent edges were not used as proof of unused code.
- Ran `node --test agentops-cli/test/cli-surface.test.js agentops-cli/test/cli-dispatch.test.js`: **9 passed, 0 failed, 0 skipped**. This proves those current local command contracts, not proposed simplification or product usefulness.
- Inspected manifests, tracked-file inventory, entry points, selected source relationships and plan constraints. No npm pack/prepack, dependency install, cloud write or paid/model invocation ran in this audit.
- Deployment state, current Microsoft/GitHub product support, full test/eval outcomes and rendered UI proof belong to the companion research and verification reports. Source availability is not deployment evidence.

`net: -0 lines, -0 deps proven removable; larger profile/retirement savings remain conditional on consumer inventory and migration verification.`
