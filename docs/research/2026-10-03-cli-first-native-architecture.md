# CLI-first native telemetry: architecture and completion contract

Date: 2026-10-03. Status: researched design; not a completed installer or cloud release.

## Result

Build one installed local companion, with Copilot CLI as the primary target. Use native Copilot OpenTelemetry (OTel), selected Python/JS library instrumentation, one local Collector, and the existing Azure ingestion/report path. The CLI plugin supplies status and reports. VS Code supplies a secondary interface. Users should not need to install an AgentOps CLI, Azure CLI, Docker, or a separate Node runtime.

A plugin alone cannot provide this complete setup. Native CLI telemetry must be configured before the CLI starts. A child hook or extension cannot change its parent process environment. Enterprise managed telemetry policy is the documented way to cover ordinary terminals. An unmanaged device needs an explicit prelaunch setup path. See the [CLI audit](2026-10-03-cli-primary-docs.md) and [GitHub CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).

## Architecture and data flow

```text
One installer / enterprise device policy
  |-- stable local capture service and native startup configuration
  |-- CLI plugin: status, local report, capture controls
  |-- optional VS Code interface
  `-- selected project Python / JS bootstrap
                  |
Copilot CLI ------+-- native agent / model / tool spans
Python / JS ------+-- script roots + supported library spans
VS Code Chat -----+-- native spans after qualified startup / reload
                  v
          Owned loopback OTel Collector
          Approved semantics; content / identity filtering
                  |
          Bounded private local queue and receipt
                  |-- local report and capture health
                  v
          Authenticated Azure uploader
                  v
          Existing DCR -> custom tables -> Workbook
```

DCR means Data Collection Rule. It defines the schema accepted by Azure Logs Ingestion. OTLP, the OTel transport, cannot be sent directly to a DCR as if it were those JSON rows. The uploader must perform a tested conversion. [Microsoft Logs Ingestion guide](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview).

Keep the capture service independent of VS Code window lifetime. Use a stable endpoint with one owner, port-conflict detection, bounded shutdown flush, and recovery after a crash. Do not silently capture remote SSH, containers, or unrelated processes: loopback points to the machine that executes the client.

## What exists and what remains

| Capability | Current evidence | Required completion |
| --- | --- | --- |
| Native CLI in new VS Code terminals | Real extension context delivers eight variables; Disconnect removes them from later terminals | Real CLI-generated span receipt and restart proof |
| Native CLI in ordinary terminals | Documented startup environment and managed policy | Installed companion, effective policy/setup, service lifecycle and rollback |
| CLI plugin interface | Existing hooks/skills; documented native JS extension API | Status/report integration; native JS path is experimental and cannot be the only baseline |
| VS Code Chat | Settings API, package, Collector and fixture checks passed | Correct reload lifecycle; real Chat receipt; rendered UI check |
| Owned Python/Node script roots | Existing manifest/hash-scoped observers | Qualification in the new companion path |
| HTTP/framework/database library spans | Official OTel supported-library contracts | Pinned packages, project setup, context and loader tests |
| Automatic Azure upload | Existing uploader and prior synthetic typed readback | Remove user Azure CLI dependency; native batch conversion/readback and explicit destination authorization |
| Diagnostic value | Reports and controlled local tests exist | Independent user comparison on real failures; value remains unmeasured |

The prior verification reports contain 34 passing focused checks, a passing full CLI suite, actual Collector JSON/protobuf filtering, process cleanup, and real terminal environment inheritance. These are valid local proof. No live model turn ran in that qualification. They do not prove that Copilot CLI or Chat emitted native spans. See [prior verification](2026-10-03-native-onboarding-verification.md).

## Install and use contract

1. An administrator deploys the companion and supported managed telemetry policy for enterprise devices. The policy routes native CLI telemetry to a fixed local endpoint, disables message content, and locks content capture. Personal devices use explicit prelaunch setup with consent and conditional restore. Do not invent a user-level Copilot telemetry settings key.
2. Users continue to start `copilot` normally. The plugin shows whether native spans were received, whether scripts were observed, and whether Azure delivery was confirmed. An open socket is only service health.
3. A user attaches a project and selects a supported interpreter/runtime. The companion enables instrumentation only for approved process launches. Package setup occurs inside the selected environment. Preserve virtual environments, existing Python startup hooks, Node options, and tool permissions.
4. Azure sign-in and destination setup are a separate, explicit step. Keep tokens in the platform credential store. Never ship shared publishing secrets in plugin files, process telemetry headers, or trace attributes. An Azure-hosted publisher can use managed/workload identity; a desktop cannot be assumed to have managed identity.
5. Disconnect stops owned capture and restores only configuration that still matches the companion's values. Uninstall removes owned setup without overwriting later user or administrator changes.

The current uploader invokes `az account get-access-token`. This must change before automatic Azure publishing can satisfy the no-extra-CLI requirement. The design should prefer the existing direct upload path with supported platform sign-in where enterprise permissions permit it. Add a cloud gateway only if an actual authentication or trust requirement demands one.

## Automatic Python and JS/TS coverage

Native Copilot spans cover agent, model, subagent, and tool boundaries. They do not instrument every function inside a tool program. Supported-library instrumentation can add HTTP, framework, database, and queue spans. Important internal business steps still need explicit spans. [OTel Node guide](https://opentelemetry.io/docs/zero-code/js/), [Python source contract](https://github.com/open-telemetry/opentelemetry-python-contrib/blob/2d9c5d05ee8c4944a130ceecdea67f036d1b3982/opentelemetry-instrumentation/README.rst).

Keep the existing dependency-free script-root observer as the small baseline. Add library tracing as an optional project capability. Node CommonJS, ESM, compiled TypeScript, and development loaders need distinct tests. Python needs the correct interpreter, compatible packages, and one tested startup bootstrap; both the current observer and upstream instrumentation use `sitecustomize`. Do not insert global hooks into all Python or Node processes.

A shared run ID is a logical link. A physical parent-child trace requires real context injection and extraction. The SDK supports trace-context bridges, but the public CLI hook contract does not promise the tool's current trace context. Report unavailable physical parentage truthfully rather than inferring it from timestamps. See [SDK audit](2026-10-03-sdk-native-docs.md).

## Three priority repairs

1. **Chat restart lifecycle.** Installed Chat fixes its active export configuration at startup and requires reload. AgentOps currently restores settings and stops the Collector during extension shutdown, then selects a new endpoint. Retain opted-in configuration through routine shutdown, restart at the same endpoint, restore only on explicit Disconnect or failed setup, and show Reload required until verified receipt. This defect is found but not repaired in this research. [Exact source evidence](2026-10-03-vscode-native-deep.md).
2. **Safe semantic meaning.** The active local policy replaces all metric names with `agentops.metric` without preserving original names. It also removes labels required by generic library diagnostics. Preserve only exact approved instrument names, units, numeric types and bounded operation enums. Separate unknown instruments. Test poisoned values as well as known counters and histograms. The current eleven custom streams have no general native metric/histogram mapping. Add only a schema justified by a report, or keep that signal local. [Filter audit](2026-10-03-auto-instrument-azure-docs.md).
3. **Azure sign-in and proof.** Replace the Azure CLI token dependency for the user flow, enforce destination scope, and prove an authorized native batch with typed readback. Existing custom tables do not populate standard Application Insights Agents views automatically. A standard Azure Monitor route is a separate conversion, privacy and dashboard contract.

## Cost and security

Start with the existing Logs workspace, DCR and Workbook contract. Use traces and small numeric aggregates first. Avoid AKS, hosted Grafana, a second database, and a permanent gateway without a measured need. Filter before storage/upload, limit local queue bytes and age, and enforce a publisher byte budget. Show dropped records and incomplete coverage.

This architecture reduces new service count; it does not establish a current monthly price. Measure accepted/billed bytes and use the selected region's rates before deployment. The existing EUR10 budget is an alert threshold, not a spending cap. Azure daily caps can overshoot and stop useful monitoring. [Azure cost model](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/cost-usage), [daily-cap limits](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap).

Keep content capture off and local receivers on loopback. Content-off alone does not remove identities, URLs, paths, error text, or unsafe values in allowed metadata. Use controlled field semantics and canaries before durable storage. Keep service health, receipt, observed coverage, upload acceptance, cloud readback, and task outcome as separate states.

## Acceptance checks in build order

1. Prove actual native CLI export to a private local Collector on the exact supported runtime: agent/model/tool spans, token totals without duplicate counting, cancellation and flush. A local test provider may avoid paid requests, but synthetic model responses must remain labelled synthetic.
2. Build and test companion startup, plugin controls, stable endpoint, repeated sessions, duplicate owners, conflicts, restart, Disconnect and uninstall in disposable profiles. Test managed policy per supported OS; do not claim untested OS support.
3. Prove the selected Python, CommonJS, ESM and TypeScript runtime matrix. Test HTTP/library spans, existing SDK/startup conflicts, short-process flush, canaries, parentage, missing coverage, and overhead.
4. Repair and test Chat reload in an isolated real extension host. Exercise rendered controls and a native turn. Keep Agent Host and remote capture unavailable until independently qualified.
5. Prove safe named metrics and any new accepted schema through the actual filter, queue, converter and authorized Azure typed readback. Test duplicates, retries, rejected schema, expired sign-in and byte limits.
6. Compare diagnosis using the report against the baseline on held-out failures. Measure correct diagnosis, time, missed spans, overhead, accepted bytes and cost. Ship broader collection only when this test supports its value.

No new upstream tests, model sessions, Azure uploads, device policy writes, dependency installs, or product changes ran during this research. Earlier local results are reused only for unchanged code. The next build item is actual native CLI receipt proof; the product is not yet qualified as fully automatic telemetry for both clients.

## Saved source corpus

Nine official source repositories were cloned to verified external storage. Exact commits, URLs, source dates and tracked-clean checks are in `/Volumes/SanDisk Archive/Agent-Workspace/workspaces/copilot-native-docs-20261003/corpus-manifest.json`. Relevant documents and source paths were read; this is not a claim that every cloned page was read. The CLI repository contains public docs/install files, not its closed runtime source.

Azure Monitor source is pinned at `583ced423b23f0c40b1c214768201ad122e09f06` (2026-10-02), with ten selected Markdown files. The SDK main snapshot, released SDK 1.0.14 runtime 1.0.85, installed CLI 1.0.91, and installed Chat artifact are separate versions. Public Chat source is older than the installed bundle. Capability discovery must use the installed release, not main-branch claims.

Detailed evidence: [CLI](2026-10-03-cli-primary-docs.md), [SDK](2026-10-03-sdk-native-docs.md), [VS Code](2026-10-03-vscode-native-deep.md), [OTel and Azure](2026-10-03-auto-instrument-azure-docs.md).
