# Copilot agent observability and architecture improvement plan

Status: accepted direction, implementation pending. Updated 29 September 2026.

## Decision and outcome

Build Copilot CLI coverage first, then add other Copilot surfaces through adapters with explicit capability ratings. Default setup is project-local and does not require a persistent Copilot or script wrapper. An optional script runner provides exact script boundaries and trace-context bridging where native signals and auto-instrumentation cannot. Approved rich work content may reside in restricted Azure storage; development uses synthetic or public data only.

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
| Basic | Provision Azure once, attach a repo once, enable CLI OTel via enterprise policy or a single-session launch | Native agent/model/tool events and available skill/selection events across the repo, with explicit gaps |
| Enhanced | Opt in owned Node/Python scripts | Supported library activity and script status where runtime configuration proves it |
| Deep | Add named internal spans or optional runner | Important script steps, reliable process boundary, and stronger trace correlation |

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

### Copilot boundary

Use native Copilot OTel as the primary source for model/tool timing and IDs, session events for richer lifecycle detail, and project hooks only for gaps that they can observe without altering tool behavior. Reconcile rather than count duplicate observations as separate operations. Retain original IDs and record which source supplied each field. Do not infer exact causality from nearby timestamps.

GitHub documents native model/tool spans, skill-invocation events, `/agent` selection, and CLI hooks. These are useful sources, not proof that every skill reference or subprocess step is emitted. [Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [custom agents](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli), [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference).

### Scripts without a mandatory wrapper

1. Native `execute_tool` and hook/session records establish **that a command was requested and how it ended**, when those records are present.
2. For owned Node and Python scripts, offer project-local auto-instrumentation of supported libraries (for example HTTP/database clients) through explicit dependencies and session-scoped environment configuration. Do not mutate user/global shell or package-manager configuration. Auto-instrumentation does not reveal arbitrary application functions. [OTel zero-code boundary](https://opentelemetry.io/docs/concepts/instrumentation/zero-code/), [Node setup](https://opentelemetry.io/docs/zero-code/js/), [Python setup](https://opentelemetry.io/docs/languages/python/getting-started/).
3. Offer a small library/API for named internal spans at important script steps such as parse, fetch, classify, and validate. Keep a script runnable without telemetry and report export failure separately from task failure.
4. Use an optional `agentops-run` only when the user needs a guaranteed script start/end span, exit code, bounded output capture, or explicit propagation into a subprocess. It must be a project-owned invocation, with no persistent shell alias, global hook, or hidden command rewriting.
5. Test whether Copilot CLI supplies a valid parent `traceparent` to spawned code. If it does, continue the trace. If it does not, use explicit session/run and tool-call correlation and mark the script span as a **logical link**, not a physical child. OTel environment carriers are currently release candidate; use standard propagators and verify actual Node/Python behavior before depending on them. [OTel process propagation](https://opentelemetry.io/docs/specs/otel/context/env-carriers/).

### Setup assistant in the repository

Create or revise one Agent Skill to interview a repo maintainer about runtime, languages, script entry points, Azure target, content mode, and ownership. It should inspect the repo and current installation before proposing changes; generate a project-local manifest and preview exact file edits; apply only selected setup; run a synthetic smoke; verify Collector receipt and Azure readback; and offer a removal command that deletes only manifest-owned changes after checking for user edits. The skill is the **guided setup interface**. The CLI and Collector perform tracing deterministically, so correctness does not depend on an agent remembering instructions. Reuse `agentops-setup` and `agentops-custom-telemetry` rather than adding a competing skill pack. Agent Skills already defines portable `SKILL.md`, `references/`, and `scripts/` layout and progressive loading. [Agent Skills specification](https://agentskills.io/specification).

## Delivery stages and acceptance

| Stage | Deliverable | Proof required |
| --- | --- | --- |
| 0. Evidence contract | Versioned run/operation/component IDs, event source, parent or logical link, content policy, and coverage states | Synthetic records from native OTel, session, hook, and script sources merge without duplicate operations; missing IDs stay unjoined |
| 1. Complete synthetic CLI run | One public/synthetic agent selected via `/agent`, one delegated subagent, progressive skill activation, a reference read, two tools, one Node or Python script, and an outcome | Run view shows the observed order/overlap, prompts and tool data in approved mode, errors, explicit gaps, and original source records |
| 2. Project-local script setup | Reversible onboarding skill plus optional Node/Python auto-instrumentation and named internal spans; runner only where needed | Plain Copilot CLI still works; project setup/removal round-trip preserves user files; script success/failure, HTTP/internal step, and correlation status appear in the same run |
| 3. Azure evidence and quick start | Safe Bicep topology plus one-line `provision` and repo-local `attach`/`detach` for native spans, script spans, run ledger, and approved rich content | Fresh subscription target deploys only expected resources; attach works for two distinct synthetic agent repos without per-agent edits; native OTel is verified under enterprise policy or a single-session launch, not assumed from attach; detach preserves user changes; Azure readback shows exact run links, access policy, retention/cost limits, and negative privacy tests |
| 4. Architecture intelligence | Declared/observed map and deterministic findings for skills, references, scripts, tools, and subagents | Every frequency has denominator and source coverage; unobserved is never called unused; findings link to example runs |
| 5. Evaluation loop | One-change candidate workflow and protected baseline/candidate test set | Same tasks, repeated runs where needed, quality and critical regressions before cost/latency; accepted and rejected candidates retained |
| 6. Further surfaces | VS Code and GitHub-hosted compatibility adapters | Versioned capability matrix and per-surface smoke/readback; unsupported details visibly absent |

### First release gate

The smallest credible pilot is stages 0–3 on synthetic data. A user can provision an isolated Azure target with one command, attach either of two different synthetic Copilot CLI agent repos without changing individual agents, activate native OTel through an approved enterprise policy or one reversible session launch, and open one run with agent/subagent lanes, activated skill, reference read, script timing and internal step, tool inputs/results where approved, and the final outcome. The same run is queryable in Azure, with an explicit coverage report. Detach removes only AgentOps-owned project changes; plain Copilot CLI and unrelated project files continue to work.

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
