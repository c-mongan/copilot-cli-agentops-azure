# Copilot agent observability and architecture improvement plan

Status: accepted direction, implementation pending. Updated 29 September 2026.

## Decision and outcome

Build Copilot CLI coverage first, then add other Copilot surfaces through adapters with explicit capability ratings. Full end-to-end coverage of owned skill scripts is a release requirement: use auto-instrumentation, explicit spans, and a controlled script entry point wherever needed to prove the links. Prefer project-local setup without a persistent global wrapper, but do not weaken trace fidelity to preserve a wrapper-free preference. Approved rich work content may reside in restricted Azure storage; development uses synthetic or public data only.

The product's job is to answer two linked questions: **what happened in this run?** and **which architecture change is supported by repeated evidence and a controlled evaluation?** A waterfall alone answers only part of the first question.

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

`attach` should discover Copilot CLI agents and Agent Skills in the repo, configure project-owned hooks and Collector settings, run a synthetic smoke, and report a coverage matrix. It should not require editing every agent or skill, installing global shell hooks, or replacing plain `copilot`. **Native CLI OTel is a separate activation gate:** GitHub currently documents environment variables or enterprise managed settings, not a general repo-local OTel switch. Enterprise policy is the low-touch route for ordinary `copilot`; a reversible, single-session launch command is the local fallback. `attach` must report `native OTel inactive` until a receipt proves activation, and must not imply that a repo config file alone enabled it. The companion `agentops detach --repo .` must preview and remove only changes owned by the attach manifest, preserving user edits. These commands are **planned, not implemented**. A repo Agent Skill can guide the first-time choices and explain failures; the commands must do the repeatable work. [Copilot CLI OTel activation](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring), [enterprise managed settings](https://docs.github.com/en/copilot/concepts/enterprise/opentelemetry).

| Level | Setup | Expected visibility |
| --- | --- | --- |
| Discovery | Provision Azure once, attach a repo once, enable CLI OTel via enterprise policy or a single-session launch | Native agent/model/tool events and available skill/selection events across the repo, with explicit gaps; not the full product |
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
| User task → selected agent or delegated subagent | Copilot lifecycle event/span with agent identity and original parent/run identifiers |
| Agent → activated skill | Skill invocation event and the versioned skill definition; discovery alone is not activation |
| Skill → reference | Observed file/resource read tied to the run, resolved against the skill's declared references; a declared reference alone is not use |
| Skill or agent → script | Observed command/tool call and script process start with exact correlation where available; a path-and-time match is labelled inferred |
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

### Setup assistant in the repository

Create or revise one Agent Skill to interview a repo maintainer about runtime, languages, skill script entry points, important internal steps, Azure target, content mode, and ownership. It should inspect the repo and current installation before proposing changes; generate a project-local manifest and preview exact file edits; apply the instrumentation required for the agreed full scope; run a synthetic smoke through each owned script path; verify Collector receipt and Azure readback; and offer a removal command that deletes only manifest-owned changes after checking for user edits. The skill is the **guided setup interface**. The CLI and Collector perform tracing deterministically, so correctness does not depend on an agent remembering instructions. Reuse `agentops-setup` and `agentops-custom-telemetry` rather than adding a competing skill pack. Agent Skills already defines portable `SKILL.md`, `references/`, and `scripts/` layout and progressive loading. [Agent Skills specification](https://agentskills.io/specification).

## Delivery stages and acceptance

| Stage | Deliverable | Proof required |
| --- | --- | --- |
| 0. Evidence contract | Versioned run/operation/component IDs, event source, parent or logical link, content policy, and coverage states | Synthetic records from native OTel, session, hook, and script sources merge without duplicate operations; missing IDs stay unjoined |
| 1. Complete synthetic CLI run | One public/synthetic agent selected via `/agent`, one delegated subagent, progressive skill activation, a reference read, two tools, one Node or Python skill script, and an outcome | Run view proves the traceability chain above, observed order/overlap, prompts and tool data in approved mode, errors, and original source records; any missing edge blocks a full-coverage claim |
| 2. Project-local script setup | Reversible onboarding skill plus Node/Python instrumentation for every in-scope owned skill script and named internal spans; controlled entry point where needed | Plain Copilot CLI still works; setup/removal round-trip preserves user files; script success/failure, supported outbound call, named internal step, and exact or explicitly logical correlation appear in the same run |
| 3. Azure evidence and quick start | Safe Bicep topology plus one-line `provision` and repo-local `attach`/`detach` for native spans, script spans, run ledger, and approved rich content | Fresh subscription target deploys only expected resources; attach works for two distinct synthetic agent repos without per-agent edits; native OTel is verified under enterprise policy or a single-session launch, not assumed from attach; detach preserves user changes; Azure readback shows exact run links, access policy, retention/cost limits, and negative privacy tests |
| 4. Architecture intelligence | Declared/observed map and deterministic findings for skills, references, scripts, tools, and subagents | Every frequency has denominator and source coverage; unobserved is never called unused; findings link to example runs |
| 5. Evaluation loop | One-change candidate workflow and protected baseline/candidate test set | Same tasks, repeated runs where needed, quality and critical regressions before cost/latency; accepted and rejected candidates retained |
| 6. Further surfaces | VS Code and GitHub-hosted compatibility adapters | Versioned capability matrix and per-surface smoke/readback; unsupported details visibly absent |

### First release gate

The smallest credible pilot is stages 0–3 on synthetic data. A user can provision an isolated Azure target with one command, attach either of two different synthetic Copilot CLI agent repos, instrument the owned skill scripts discovered during setup, activate native OTel through an approved enterprise policy or one reversible session launch, and open one run with the complete observed chain: agent/subagent lanes, activated skill, reference read, script root and internal steps, tool inputs/results where approved, and the final outcome. The same run is queryable in Azure, with an explicit coverage report. A missing required link blocks the full-coverage claim. Detach removes only AgentOps-owned project changes; plain Copilot CLI and unrelated project files continue to work.

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

## References

- [Full product requirements](../requirements/full-agent-observability-requirements.md)
- [Requirements reconciliation](../research/2026-09-29/requirements-reconciliation.md)
- [CLI-first flight recorder](../cli-first-flight-recorder.md)
- [Agent Skills overview](https://agentskills.io/home) and [specification](https://agentskills.io/specification)
- [GitHub Copilot CLI OTel reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Azure Monitor Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)
