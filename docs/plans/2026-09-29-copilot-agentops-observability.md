# Copilot AgentOps master plan

Status: working master plan; implementation pending and technical proofs remain open. Updated 29 September 2026. This is the authoritative product and delivery plan. The [full requirements](../requirements/full-agent-observability-requirements.md) remain the scope register; phase-specific implementation plans should link here rather than restate it.

## Decision and outcome

Build Copilot CLI coverage first, then add other Copilot surfaces through adapters with explicit capability ratings. The default observation unit is an **opted-in Copilot process/run**, not every Copilot session in a repository. Discover the whole repository's declared architecture and support any selected agent, but do not install repository hooks, permanent plugin hooks, global shell exports, or enterprise telemetry merely because one maintainer attached the repository. Full end-to-end coverage of in-scope owned skill scripts is a release requirement: use auto-instrumentation, explicit spans, and a controlled script entry point wherever needed to prove the links. Approved rich work content may reside in restricted Azure storage; development uses synthetic or public data only.

The product's job is to answer two linked questions: **what happened in this run?** and **which architecture change is supported by repeated evidence and a controlled evaluation?** A waterfall alone answers only part of the first question.

### What success means

The first user can select a Copilot CLI agent, start an observed session without changing colleagues' sessions, and inspect a single run from prompt through parent/subagents, activated skills, observed reference reads, native/MCP tools, owned script entry points and meaningful internal steps, failures/retries, and final answer. Every displayed relationship names its source and certainty. The same synthetic run can be read back from Azure. A setup assistant makes instrumentation and removal predictable. Architecture findings are evidence-backed hypotheses that can be tested against a protected baseline; they are not automatic refactors.

Three product entry points keep this understandable: **Runs** (find a run and open its failure-first waterfall), **Architecture** (declared versus observed agents, skills, references, scripts, and tools), and **Compare** (baseline versus one proposed change). Specialist KQL/Grafana, collector health, policy, and cost views remain available beneath these.

### Delivery principles

1. Prefer the runtime's own events and spans; add the smallest adapter needed for a missing edge. Preserve original evidence and IDs.
2. Scope collection before it starts. Filtering a rich trace after capture does not prevent collection of another agent's content in the same process.
3. Never claim a physical parent span from timestamps, path similarity, or an independently generated trace ID. Record a logical link and its evidence instead.
4. Instrument every agreed owned script path in a full-coverage pilot; keep unsupported third-party and runtime internals visible as gaps.
5. Keep ordinary agent behavior intact: telemetry failure must not change tool permission, script exit status, or answer. Policy enforcement is a separate opt-in product.
6. Use synthetic or public agents for development. Work data requires an authorized work deployment with its own access and content policy.

## Setup experience is an acceptance requirement

For a new Azure target, the intended public command is **one line** after the operator has signed in to Azure:

```bash
agentops provision azure --subscription <subscription-id> --resource-group <new-agentops-rg> --profile pilot
```

This is a **planned command, not a working command today**. It must select the subscription explicitly, preview the Bicep changes, create only AgentOps-owned resources, configure Entra-based ingestion and least-privilege access, apply retention and cost controls, and print the resource IDs plus a verification receipt. It should be rerunnable without duplicating resources and must refuse unexpected modifications to existing resources. The current `azd provision` path and main Bicep template cannot be used as this command's implementation until the existing Application Insights workspace-repointing hazard and postprovision Grafana hook are resolved.

For an existing repository, the intended second quick-start is one project-local attach command:

```bash
agentops attach --repo . --azure <agentops-environment>
```

`attach` should discover Copilot CLI agents and Agent Skills in the repo, prepare a local manifest and Collector settings, identify script entry points, and report a coverage matrix. It must preview any script instrumentation edits and keep an ownership record for removal. It must **not** commit `.github/hooks/*.json`, persistently install a hook-bearing plugin, modify global shell startup, or enable enterprise telemetry as a side effect. Native CLI OTel requires process environment activation or an explicit enterprise setting; a project file alone cannot enable it. The default setup prints or starts a single-session native `copilot` command with scoped OTel environment and, where needed, an observation-only plugin loaded through `--plugin-dir`. A temporary launch command is allowed; replacing or shadowing `copilot` is not required. `attach` reports `native OTel inactive` until a receipt proves activation. The companion `agentops detach --repo .` previews and removes only manifest-owned changes while preserving user edits. These commands are **planned, not implemented**. [Copilot CLI OTel activation](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring), [temporary plugin directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [hook loading scope](https://docs.github.com/en/copilot/reference/hooks-reference).

**Session boundary:** selecting an agent with `copilot --agent <name>` at launch is the clearest full-content path. `/agent` selection later in the same process is observable when native telemetry was enabled from launch, but earlier turns in that process may also be captured. A content policy must not describe those earlier turns as excluded merely because the viewer later filters them out. A plain process started without OTel cannot be reconstructed retroactively. Team-wide deployment remains a separate, explicit administration mode after the personal pilot proves safe.

The original requirements ask for repo-wide instrumentation so a routing mistake (expected agent A, actual agent B) is visible. Within an opted-in process, capture **every actual agent and subagent**, including B; never filter collection to A. The repository inventory likewise covers all declared agents. The latest requirement to leave other contributors alone limits *which processes start collection*. Approved team-wide collection can be added later, with explicit participant scope and content policy. [Original scope requirements](../requirements/full-agent-observability-requirements.md).

| Level | Setup | Expected visibility |
| --- | --- | --- |
| Discovery | Provision Azure once, attach a repo once, and opt one Copilot process into native OTel | Native agent/model/tool events and available skill/selection events for that process, with explicit gaps; not the full product |
| Full owned flow | Instrument every in-scope owned skill script through project-local language setup and controlled entry points where needed | Exact script execution, outcome, meaningful internal steps, and link back to the invoking tool/skill |
| Unsupported surface | Show the nearest observed boundary and the missing edge | Honest partial coverage until an adapter or runtime capability closes the gap |

The product may support any GitHub Copilot agent by **discovering it and showing the available evidence**; it cannot guarantee identical deep coverage for every runtime or arbitrary script with zero setup. Each unsupported field stays visible as a coverage gap.

```text
Declared architecture: agents → skills → references / scripts / tools
                              │
Copilot CLI native OTel + session events + hooks + script OTel
                              ↓
Versioned run ledger with source, IDs, parentage, content policy, coverage
                 ├── one-run waterfall and evidence detail
                 ├── declared-versus-observed architecture
                 └── cross-run findings → one candidate → baseline comparison
                              ↓
Local Collector → Azure Monitor / Application Insights / Log Analytics
```

## What is already present

- The repository has a local Collector, Azure export configurations, strict allowlists, OTel setup guidance, session enrichment, sidecar events for selected hook scripts, KQL, dashboards, and an HTML run waterfall.
- The waterfall joins local Copilot session events to exact-session native OTel spans, with exact tool-call ID links where available. It has synthetic failure detail but no complete real agent–skill–reference–script run proof.
- `plugin/scripts/script-observability.js` writes a metadata-only `agentops.script.executed` event for a few project hooks when a session ID is available. It does not create a timed script span, capture internal steps, or instrument arbitrary skill scripts.
- The current `agentops-setup` skill assumes an installed CLI and an `agentops copilot` launcher. The new onboarding path should reuse its checks while allowing plain Copilot CLI and reversible project configuration.
- The current `plugin/hooks.json` bundles a `preToolUse` command-denial policy with failure hints, stop gates, and sidecar observation. A persistent installation makes these hooks ambient for that user's Copilot sessions. Split an observation-only plugin from an explicitly opted-in policy plugin before positioning plugin setup as safe for unrelated work. An observation hook must return no permission or stop decision.
- The existing MCP proxy records useful transport metadata, but generates an independent trace ID and injects it into MCP request metadata. That alone does not establish a parent-child relationship with Copilot's native `execute_tool` span. Native tool-call evidence comes first; transport proxying is optional and must prove its join and compatibility.
- The isolated synthetic Azure EVAL table has accepted and returned four rich-content rows. That proves the content path for those rows; it does not prove a complete joined run or approved work-data handling.

## Product boundaries

1. **Run evidence:** selected `/agent`, automatic and nested delegation, skill activation, reference reads, tool calls, commands, script execution, model activity, files changed, retries, errors, and answer, as each runtime actually exposes them.
2. **Architecture evidence:** scan declared agents and Agent Skills folders, including `SKILL.md`, `references/`, `scripts/`, and assets. Link definitions to observed runs by stable component identity and architecture version.
3. **Decision evidence:** aggregate failure, latency, token, repeated-read, routing, script, and subagent patterns with denominators and coverage. Recommendations are hypotheses until baseline/candidate evaluation passes.
4. **Surface scope:** Copilot CLI first. VS Code, GitHub-hosted agents, and other surfaces receive separate adapters and FULL / PARTIAL / METADATA ONLY / ADAPTER REQUIRED / UNAVAILABLE / UNKNOWN ratings. Never label a run complete because no event was emitted.

## Instrumentation design

### End-to-end traceability contract

For every in-scope synthetic pilot run, the run view must account for this chain:

| Edge | Evidence needed |
| --- | --- |
| User task → selected agent or delegated subagent | Copilot `invoke_agent` span and lifecycle event where available, with original trace, span, conversation, and agent identifiers; do not rely only on hooks because some built-in subagents do not emit them |
| Agent → activated skill | Skill invocation event and the versioned skill definition; discovery alone is not activation |
| Skill → reference | Observed file/resource read tied to the run, resolved against the skill's declared references; a declared reference alone is not use |
| Skill or agent → script | Observed command/tool call and script process start with exact correlation where available; a path-and-time match is labelled inferred |
| Agent → MCP tool | Native `execute_tool` span with tool name, call ID, outcome, and content only under the approved mode; server attribution is checked against the effective MCP configuration, and remote server internals require separate instrumentation |
| Script → internal work | Script root span, supported library spans, and named spans for domain steps needed to understand failures and latency |
| Script → agent continuation | Exit/exception/output, matching tool completion, subsequent agent action, and final answer or abort |

The static Agent Skills directory scan identifies **which scripts belong to which skills**. It cannot prove a script executed. The runtime chain proves execution and order. Each edge carries observed / inferred / not observed / unsupported, source, producer version, original IDs, and reason for any gap. A run is labelled **full for the declared scope** only when every required edge is observed or a documented deterministic bridge supplies it. This is a coverage claim about observable operations, not a claim to expose private model reasoning or every executed line of code.

### Copilot boundary

Use native Copilot OTel as the primary source for model/tool timing and IDs, session events for richer lifecycle detail, and project hooks only for gaps that they can observe without altering tool behavior. Reconcile rather than count duplicate observations as separate operations. Retain original IDs and record which source supplied each field. Do not infer exact causality from nearby timestamps.

GitHub documents native model/tool spans, skill-invocation events, `/agent` selection, and CLI hooks. These are useful sources, not proof that every skill reference or subprocess step is emitted. [Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [custom agents](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli), [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference).

### Owned skill scripts

1. Native `execute_tool` and hook/session records establish **that a command was requested and how it ended**, when those records are present.
2. Instrument every **in-scope owned** Node and Python skill script with a project-local bootstrap, including a root script span, outcome, and supported library calls (for example HTTP/database clients). A setup skill may propose and apply the small entry-point edits or package changes needed; it must verify and record each change for clean removal. Do not mutate user/global shell or package-manager configuration. Auto-instrumentation does not reveal arbitrary application functions. [OTel zero-code boundary](https://opentelemetry.io/docs/concepts/instrumentation/zero-code/), [Node setup](https://opentelemetry.io/docs/zero-code/js/), [Python setup](https://opentelemetry.io/docs/languages/python/getting-started/).
3. Add a small library/API for named internal spans at important script steps such as parse, fetch, classify, and validate. The onboarding interview identifies those steps with the maintainer. Keep a script runnable without telemetry and report export failure separately from task failure.
4. Use a project-owned `agentops-run` or equivalent controlled entry point whenever required to prove script start/end, exit code, bounded output capture, or exact context propagation. It must not create a persistent global alias or silently rewrite unrelated commands. Ease of setup means the setup assistant performs and verifies this once, not that necessary instrumentation is omitted.
5. Test whether Copilot CLI supplies a valid parent `traceparent` to spawned code. If it does, continue the trace. If it does not, use explicit session/run and tool-call correlation and mark the script span as a **logical link**, not a physical child. OTel environment carriers are currently release candidate; use standard propagators and verify actual Node/Python behavior before depending on them. [OTel process propagation](https://opentelemetry.io/docs/specs/otel/context/env-carriers/).
6. Avoid preloading Node auto-instrumentation into the Copilot CLI process merely to reach child scripts. A script-local bootstrap or controlled script entry point activates under an opted-in run marker; ordinary script invocations behave normally when no marker is present. Verify this for both Node and Python.

### Hook and plugin isolation

The normal path needs no persistent repo hook. Native OTel supplies agent, model, tool, and skill events. If a reference-read or lifecycle gap needs a hook, load a **passive observer** only in the opted-in process and verify that its output cannot deny/modify tools or stop the agent. An installed plugin is ambient to sessions using that user's Copilot configuration; a `--plugin-dir` plugin is scoped to the launched process. Tool-name and subagent-name matchers narrow individual hook events, but do not provide a general selected-agent filter. [Hook reference](https://docs.github.com/en/copilot/reference/hooks-reference), [plugin directory loading](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/plugin-directories).

An opt-in session may contain several agents and turns. The run ledger scopes analysis by native identity and parentage. Content capture and export remain process-level decisions and must be disclosed at launch. Team-wide observation is a different deployment profile with documented participant scope, admin policy, and rollback.

### Setup assistant in the repository

Create or revise one Agent Skill to interview a repo maintainer about runtime, languages, skill script entry points, important internal steps, Azure target, content mode, and ownership. It should inspect the repo and current installation before proposing changes; generate a project-local manifest and preview exact file edits; apply the instrumentation required for the agreed full scope; run a synthetic smoke through each owned script path; verify Collector receipt and Azure readback; and offer a removal command that deletes only manifest-owned changes after checking for user edits. The skill is the **guided setup interface**. The CLI and Collector perform tracing deterministically, so correctness does not depend on an agent remembering instructions. Reuse `agentops-setup` and `agentops-custom-telemetry` rather than adding a competing skill pack. Agent Skills already defines portable `SKILL.md`, `references/`, and `scripts/` layout and progressive loading. [Agent Skills specification](https://agentskills.io/specification).

## Delivery stages and acceptance

### Build versus reuse

| Reuse | Build only the missing layer |
| --- | --- |
| Copilot CLI native OTel, session events, hooks, and SDK harness for controlled evaluation | Source-preserving run ledger, evidence joins, capability/coverage report, and opt-in setup |
| OpenTelemetry Node/Python libraries and local Collector | Script entry-point bootstrap, named-step helper, and deterministic context bridge where required |
| Azure Monitor/Application Insights, Log Analytics, Agents view, KQL, and Grafana | Failure-first run waterfall and declared-versus-observed architecture view |
| Existing repository Azure/Bicep/KQL/Grafana/proxy code | Safe new-target Bicep, one-line provisioning, passive observer split, tested rich-content policy, and reversible attach/detach |
| Existing evaluation runners where their execution model matches Copilot CLI | One-change candidate contract, protected holdout, run-to-evaluation evidence links |

### Ordered work packages

1. **Producer proof and evidence contract:** capture actual Copilot CLI OTel and session records for a synthetic parent/subagent/skill/reference/MCP/tool/script run; version the fixture and IDs. Define `Run`, `Observation`, `Operation`, `ComponentVersion`, `EvidenceEdge`, and `CoverageGap` with source, exact versus logical parentage, timestamps, original IDs, and content mode. Fix current parser loss or mislabelling before building UI on it.
2. **Isolation and onboarding:** split the existing plugin into passive observation and separate policy; prove the passive variant changes no decisions. Implement opt-in process launch using native `copilot`, OTel environment scoped to that launch, optional `--plugin-dir`, a discover/preview/ownership manifest, and a clean detach. Verify ordinary sessions and scripts are unaffected.
3. **Script and MCP depth:** inventory owned skill scripts and references; add conditional Node/Python script root spans plus named internal steps; use a controlled entry point only where exact boundaries/context require it. Join native MCP tool calls to known configured servers without inventing parentage; proxy remote internals only when explicitly needed and compatible.
4. **Run experience:** render a run list and one failure-first waterfall with parent/subagent lanes, overlapping steps, input/output under policy, exact source links, and prominent missing-edge coverage. A declared item is visually different from an observed use.
5. **Azure pilot:** repair the Bicep what-if hazard, provision a fresh isolated target with one command, send native/script/ledger data through the local Collector, and read the synthetic run back with role, retention, cost, and privacy checks. Azure writes are limited to the selected subscription/resource group and are never inferred from a local receipt.
6. **Architecture and evaluation:** aggregate only covered observations with denominators, distinguish never-observed from unused, then test one candidate change against the same synthetic/public tasks with critical regressions first. Add VS Code/cloud adapters only after CLI evidence and each surface's capability profile are proven.

Each package gets a separate executable implementation plan with exact files, interfaces, tests, and rollback before code work. Packages 1–5 are the first credible product pilot; package 6 fulfills the broader architecture-improvement goal.

| Stage | Deliverable | Proof required |
| --- | --- | --- |
| 0. Evidence contract | Versioned run/operation/component IDs, event source, parent or logical link, content policy, and coverage states | Synthetic records from native OTel, session, hook, and script sources merge without duplicate operations; missing IDs stay unjoined |
| 1. Complete synthetic CLI run | One public/synthetic agent selected at launch, one delegated subagent, progressive skill activation, a reference read, one MCP tool, another native tool, one Node or Python skill script, and an outcome | Run view proves the traceability chain above, observed order/overlap, prompts and tool data in approved mode, errors, and original source records; any missing edge blocks a full-coverage claim |
| 2. Project-local script setup | Reversible onboarding skill plus Node/Python instrumentation for every in-scope owned skill script and named internal spans; controlled entry point where needed | Plain Copilot CLI still works; setup/removal round-trip preserves user files; script success/failure, supported outbound call, named internal step, and exact or explicitly logical correlation appear in the same run |
| 3. Azure evidence and quick start | Safe Bicep topology plus one-line `provision` and repo-local `attach`/`detach` for native spans, script spans, run ledger, and approved rich content | Fresh subscription target deploys only expected resources; attach works for two distinct synthetic agent repos without per-agent edits; native OTel is verified in an opted-in process, not assumed from attach; detach preserves user changes; Azure readback shows exact run links, access policy, retention/cost limits, and negative privacy tests |
| 4. Architecture intelligence | Declared/observed map and deterministic findings for skills, references, scripts, tools, and subagents | Every frequency has denominator and source coverage; unobserved is never called unused; findings link to example runs |
| 5. Evaluation loop | One-change candidate workflow and protected baseline/candidate test set | Same tasks, repeated runs where needed, quality and critical regressions before cost/latency; accepted and rejected candidates retained |
| 6. Further surfaces | VS Code and GitHub-hosted compatibility adapters | Versioned capability matrix and per-surface smoke/readback; unsupported details visibly absent |

### First release gate

The smallest credible pilot is stages 0–3 on synthetic data. A user can provision an isolated Azure target with one command, attach either of two different synthetic Copilot CLI agent repos, instrument the owned skill scripts discovered during setup, start one opted-in native Copilot process, and open one run with the complete observed chain: parent/subagent lanes, activated skill, reference read, MCP and native tool calls, script root and internal steps, tool inputs/results where approved, and the final outcome. The same run is queryable in Azure, with an explicit coverage report. A missing required link blocks the full-coverage claim. A second person starts ordinary Copilot in the same repo and produces no AgentOps hook invocation or AgentOps export. Detach removes only AgentOps-owned project changes; plain Copilot CLI and unrelated project files continue to work.

### Verification ladder

1. **Fixture contract:** replay versioned native OTel, session, MCP, hook, and script records; assert exact links, deduplication, gaps, ordering, rich-content policy, and failure states.
2. **Real local CLI:** record Copilot CLI producer version and run a synthetic parent → subagent → skill/reference → MCP/native tool → owned script path. Verify trace/ID joins against raw receipts; report physical versus logical links.
3. **Isolation:** run the observed process and a normal process in the same repository, including a different agent. Verify the normal process loads no AgentOps hook, exports no AgentOps telemetry, and its scripts still behave normally. Repeat with the observer plugin present only through `--plugin-dir`.
4. **Azure:** read back the same synthetic run; verify identity, ordered steps, content mode, restricted access, retention and cost controls, and omission of negative privacy canaries.
5. **Second repository and removal:** attach an unrelated synthetic agent repo, run its instrumented script, then detach both; verify manifest-owned changes and pre-existing files are preserved.

## Security and operations gates

- Separate STANDARD metadata, synthetic EVAL, and approved work-detail/FORENSIC policies. Content capture is explicit, with field allowlists, access roles, retention, cost caps, and readback tests. Do not use work agents or work data in the development environment.
- Record exporter failures, dropped events, duplicate source events, malformed timestamps, sampling, and incomplete runs. Observability must not silently change a script's exit status or the agent's task result.
- Bound local receipt size and collection overhead; avoid whole-file scans as receipts grow. Preserve local evidence needed to reconcile delayed Azure indexing.
- Do not deploy the current main Bicep template until its existing Application Insights workspace-repointing what-if is resolved. Use the isolated synthetic EVAL resources for the first cloud proof.
- Require an authorized work environment and access review before any work-data deployment. This plan and the Azure detail decision do not themselves authorize that deployment.

## Open technical proofs

1. Does the current Copilot CLI propagate W3C trace context into shell-launched Node/Python processes? Test it; do not infer from native span parentage.
2. Which exact CLI and VS Code versions emit enough agent/skill/reference events to satisfy each row of the capability matrix? Record fixture and producer version.
3. Can project-local auto-instrumentation be enabled for owned scripts without also instrumenting Copilot itself or changing normal script behavior? Compare overhead and trace fidelity.
4. Which hook/session fields expose shell command, file read, and output detail under each content mode? Verify with synthetic canaries and negative privacy tests.
5. How will the cloud run ledger query link App Insights spans and rich-content rows with access controls while avoiding duplicated storage and cost?
6. Does `--plugin-dir` with the actual installed CLI isolate the passive observer from other processes when the user has ambient plugins installed? Verify loaded plugin lists and behavior, rather than assuming documentation covers every configuration.
7. Which exact native fields identify an MCP server across sanitized tool names and collisions? Resolve from effective configuration when possible, and retain `unknown` where it is not provable.

## References

- [Full product requirements](../requirements/full-agent-observability-requirements.md)
- [Requirements reconciliation](../research/2026-09-29/requirements-reconciliation.md)
- [CLI-first flight recorder](../cli-first-flight-recorder.md)
- [Opt-in observation decision](../adr/0003-opt-in-observation-process.md)
- [Agent Skills overview](https://agentskills.io/home) and [specification](https://agentskills.io/specification)
- [GitHub Copilot CLI OTel reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Azure Monitor Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)
