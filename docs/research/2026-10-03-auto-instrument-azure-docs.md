# Native Copilot capture, automatic script tracing, and Azure

Research date: 2026-10-03. This report is source research and local source inspection. It is not a new live Copilot, SDK, package-install, or Azure deployment test.

> 🧠 **From Hindsight memory (AgentOps native automatic capture without CLI setup)** — the current extension configures native Copilot capture for new integrated terminals and keeps cloud publishing off. External terminals and live native emission remain separate proof gaps. The current user request makes Copilot CLI the primary target.

## Decision

Use native Copilot telemetry as the primary signal. Add automatic roots for approved Python and Node scripts through the existing scoped observers. Offer upstream library instrumentation as an optional project capability. Send only filtered records to the existing Azure path first. Do not require Docker, a new agent platform, AKS, a public Collector, or a separate user-facing AgentOps CLI.

```text
Copilot CLI native spans ───────────────┐
Approved Python / Node script roots ──┼─> local Collector -> strict filter
Optional supported-library spans ─────┘                         |
                                                 private receipt / status
                                                              |
                                                 explicit Azure publishing
                                                              |
                                       existing DCR -> custom tables -> Workbook
```

A Copilot plugin can provide an install and control surface. It cannot guarantee that every process launched by Copilot inherits instrumentation or that the plugin runs before native telemetry initializes. The parent research must verify plugin lifecycle and command/environment contracts. A launcher remains a useful fallback for early process setup; keep it an implementation detail when possible.

## What automatic means

| Layer | Useful evidence | Required setup | Limit |
| --- | --- | --- | --- |
| Native Copilot | model operations, token fields, tool spans, latency and failures emitted by the client | native OTel enabled before capture starts | does not prove every function inside a tool or task success |
| Existing script observer | script duration, bounded runtime metadata, failure/exit evidence where supervised | consent, repository attachment, unchanged script hash, scoped process environment | arbitrary commands and unlisted or changed scripts can remain unobserved |
| Upstream library instrumentation | HTTP, supported frameworks, database clients and queues | matching instrumentation packages and early startup | not all functions, packages, runtimes or loaders |
| Explicit steps | a business operation such as parse or validate | a small explicit span helper | developer-selected coverage |

This separation prevents an “all code automatically traced” claim. Upstream Python documentation explicitly requires a package with a supported integration. Node zero-code instrumentation targets supported libraries and frameworks. [Python instrumentation README](https://github.com/open-telemetry/opentelemetry-python-contrib/blob/2d9c5d05ee8c4944a130ceecdea67f036d1b3982/opentelemetry-instrumentation/README.rst), [Node zero-code guide](https://opentelemetry.io/docs/zero-code/js/).

## Node, JavaScript and TypeScript

The upstream register entry point supports startup through `--require @opentelemetry/auto-instrumentations-node/register` or process-scoped `NODE_OPTIONS`. Load it before application modules. Supported integrations include HTTP, Express, PostgreSQL, Redis, Undici and OpenAI; filesystem and host-metric instrumentation are disabled by default. An explicit enabled list keeps capture small. Disable host/cloud resource detectors for a private local pilot. The cloned main package is version `0.80.0`, requires Node `>=22.15.0`, and expects OTel JS SDK 2.x. This main snapshot is not proof that the same version is published or supported by a user's project. Pin and verify the release before bundling it. [Pinned package README](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/5bd1049ed3c3092b9bf9720b79660d427607b3f7/packages/auto-instrumentations-node/README.md), [pinned package metadata](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/5bd1049ed3c3092b9bf9720b79660d427607b3f7/packages/auto-instrumentations-node/package.json).

TypeScript syntax does not establish its runtime module system. Compiled CommonJS and compiled ESM need different startup qualification. Upstream ESM instructions require `--import` plus `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` for library patching. The supported hook is the OTel hook, not a direct import-in-the-middle hook. Development loader combinations need tests; `tsx`, `ts-node`, native TypeScript and bundled code are not interchangeable. [Pinned ESM support document](https://github.com/open-telemetry/opentelemetry-js/blob/7fae1b4e7ff6ddefff37105c3b83d29c4d572f43/doc/esm-support.md).

Local source confirms `instrumentation/node/preload.cjs` already emits manifest-gated roots through a standard-library OTLP JSON exporter and reads valid `TRACEPARENT`. It does not register the upstream Node SDK or patch HTTP/database libraries. `script-observation.js` appends scoped startup values to the caller environment; it does not change shell files. Keep this root path for the smallest default. An optional upstream adapter must share root context to avoid unrelated or duplicate script roots, must detect an existing SDK, and must flush before short processes exit. Do not preload upstream instrumentation into the Copilot process itself merely to reach its child tools.

## Python

`opentelemetry-instrument` initializes the SDK through startup injection. `opentelemetry-bootstrap` detects installed packages and can print matching requirements or install them. The default upstream OTLP transport is gRPC. A distro and the matching instrumentation packages are required. The cloned main instrumentation package requires Python `>=3.10`. A no-extra-CLI user flow can call the programmatic initializer early, but it still needs compatible packages inside the correct interpreter or virtual environment. [Pinned instrumentation README](https://github.com/open-telemetry/opentelemetry-python-contrib/blob/2d9c5d05ee8c4944a130ceecdea67f036d1b3982/opentelemetry-instrumentation/README.rst), [pinned Python metadata](https://github.com/open-telemetry/opentelemetry-python-contrib/blob/2d9c5d05ee8c4944a130ceecdea67f036d1b3982/opentelemetry-instrumentation/pyproject.toml).

The project already has a silent hash-gated `sitecustomize.py`, a Python standard-library protobuf exporter, and a supervised direct-script path. No Python package installation is required for that root evidence. The supervisor preserves interpreter/virtual-environment semantics and records actual process results for its supported direct command forms. The legacy startup hook reports unknown outcome where it cannot establish exit status. Named internal steps are explicit. These facts come from `instrumentation/python/README.md`, `agentops_launcher.py`, `sitecustomize.py` and `script-observation.js`.

Do not insert a second independent `sitecustomize` module in front of the first one. Both upstream injection and the project observer use this mechanism; order and initialization need one tested bootstrap. Preserve existing user hooks, interpreter selection, and virtual environments. Upstream startup source itself modifies `PYTHONPATH` before executing the command. [Pinned startup source](https://github.com/open-telemetry/opentelemetry-python-contrib/blob/2d9c5d05ee8c4944a130ceecdea67f036d1b3982/opentelemetry-instrumentation/src/opentelemetry/instrumentation/auto_instrumentation/__init__.py).

## Cross-process context and protocol

A shared run ID establishes a logical link. It does not prove that a particular Copilot tool span is a script's physical parent. For physical parentage, the parent must inject context into the child's environment, and startup must extract it into the child's SDK context. The environment-carrier specification assigns application code responsibility for passing SDK context to its spawning mechanism. It is Release Candidate in the pinned document. Do not infer parentage from time or file names. [Pinned environment-carrier specification](https://github.com/open-telemetry/opentelemetry-specification/blob/cda67786e931171a4d1d7bda2085e75e2f8ee41f/specification/context/env-carriers.md).

Keep exporters separate where protocols differ. CLI native JSON and script protobuf can both enter the existing local Collector. Configure an upstream SDK with its supported protocol and signal endpoint; do not inherit CLI HTTP/JSON blindly into a Python protobuf exporter. The shared receiver does not require every producer to use the same encoding. Verify missing spans, shutdown, cancellation, port conflicts, canaries and SDK duplicate initialization with real fixtures before widening coverage.

## Azure routes

| Route | Fit | Tradeoff |
| --- | --- | --- |
| Existing Logs Ingestion custom tables | smallest immediate reuse; stable typed product fields and private Workbook | does not automatically populate standard Application Insights agent views |
| Collector Azure Monitor exporter | matches Microsoft's coding-agent dashboard recipe; preserves native standard-table path | community component is beta; connection string handling and semantic mapping need qualification |
| Native Azure OTLP ingestion | standard OTel path with Entra authentication | Azure Preview; different provisioning and metric requirements; not the default production claim |
| Azure Monitor language distro directly in each script | suitable for applications already adopting Azure SDK instrumentation | separate packages and code/startup setup per environment; can bypass local privacy filter if exported directly |

The Logs API accepts JSON that matches the selected DCR input schema. The DCR controls target tables and transformations. A DCE is needed for Private Link or when the DCR lacks a direct ingestion endpoint; the existing DCE can stay in use. Scope the publisher permission to the selected DCR. [Logs Ingestion API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview).

Microsoft's coding-agent recipe uses the contrib `azuremonitor` exporter and Application Insights/Log Analytics queries. It supports the native-OTLP alternative too. Its example enables prompt content and binds a Docker receiver to all interfaces; those example defaults do not meet this project's privacy boundary. Retain loopback, content disabled, strict filtering and the existing native binary. The exporter is beta for traces, metrics and logs and recommends a connection string. Do not distribute a shared cloud publishing credential in a plugin. [Coding-agent recipe](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-opentelemetry-app-insights), [pinned exporter README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/b783053060da3bb6fe567248c2e2bf4b83731de9/exporter/azuremonitorexporter/README.md).

Native Azure OTLP is Preview. Collector export is HTTP/protobuf. Use the actual configured endpoints, Entra authentication, and Monitoring Metrics Publisher on the DCR. Metrics require delta temporality and exponential histograms for the documented Application Insights experiences; the project overlay's cumulative-to-delta processor alone does not establish histogram compatibility. Logs/traces-first qualification avoids unnecessary metric resources. [Collector ingestion guide](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-protocol-ingestion), [OTel capabilities and limitations](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/collect-use-observability-data).

The Azure Monitor distro provides automatic collection through language packages, including `@azure/monitor-opentelemetry` and `azure-monitor-opentelemetry`. This is not a universal desktop process injector. Direct Azure export must not bypass the local filter in this product. [Azure distro onboarding](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable).

## Security, cost and compatibility gaps

1. Keep local listeners on loopback. Give one recorder clear lifetime ownership. Raw prompts, tool arguments/results, credentials, URLs and identities must not enter durable receipts or Azure.
2. Use explicit managed/workload identity on an Azure publisher when available. The current `azure_auth` upstream README does not recommend default credentials for production. It also reports a receiver-auth bypass in `v0.124.0` through `v0.150.0`; outbound exporter use is unaffected. The project's current outbound-only overlay does not use that receiver path. Do not introduce a public receiver using an affected version. [Pinned authentication README](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/250ba5021089d85d28ea940097e5a2bfbe964de2/extension/azureauthextension/README.md).
3. Preserve useful safe semantics deliberately. The current local-receipt strict YAML replaces span/metric names and drops `gen_ai.agent.name`, `gen_ai.agent.id`, HTTP method and database fields. This protects privacy but can reduce standard dashboard labels and operation detail. Qualify a bounded safe label policy before claiming built-in agent dashboards work. Native IDs must not become human identity. Application Insights agent views require collected agent telemetry; custom table rows alone are insufficient. [Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view).
4. Default to traces and small numeric aggregates. Add logging and detailed metrics only when they answer a measured diagnostic question. Filter before upload, cap local outbox size/age, and use a publisher byte budget. Report dropped data as incomplete coverage.
5. Measure billed bytes and use region-specific rates. Azure Monitor charges primarily by ingestion and retention for logs; budget alerts do not stop spending. Daily caps are a backstop, can overshoot and can stop useful data. Keep the existing EUR10 pilot budget as an alert threshold, not a hard cap. Do not add AKS, dedicated Grafana or a permanent gateway for a small pilot. [Monitor cost model](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/cost-usage), [daily cap guidance](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap).

## Native metric meaning: current gap and proposed repair

The active local-receipt policy in `collector/otelcol.local.strict.yaml` sets every metric name to `agentops.metric`. It does not preserve the original name in an allowed attribute. The metric payload can retain its numeric type, unit, temporality and datapoints, but those do not recover which named instrument generated it. Different token counters, operation counters and latency histograms can therefore lose their identity or collide downstream. A safe filter must preserve meaning as well as remove content.

The scoped source audit found no general native-metric adapter in the Copilot custom-table export. `session-otel.js` reads spans; `session-span-export.js` writes `AgentOpsSpans_CL`. The typed event schema has token and cost scalar columns, which preserve values from events/spans. They do not preserve a dropped native metric name or histogram distribution. The eleven streams declared in `infra/bicep/v2-ingestion.bicep` do not include a generic OTLP metric table. This is a scoped finding for those paths, not proof that no file elsewhere handles a metric.

Other strict configurations, including `otelcol.binary.strict.yaml` and `otelcol.azuremonitor.strict.yaml`, do not contain the same metric-name rewrite. Do not assume every mode has the same privacy or semantic behavior. The extension's local policy is the relevant default here.

Proposed, not implemented in this report: preserve only exact approved native instrument names, approved units, approved numeric types and bounded enum attributes. Remove arbitrary descriptions and user labels. Reject or map unknown instrument names to a clearly separated unknown class; never merge unknown sums and histograms into one named series. Where useful, preserve a bounded operation enum rather than a raw span name. Test known counters, histograms, unsupported names and poisoned metadata through the actual Collector. Keep untrusted values out of both metric identity and labels. This can improve native diagnostics without enabling content capture or adding a premium Azure service.

The parent also verified a VS Code client lifecycle limitation: its installed telemetry pipeline can retain the old endpoint until reload. A restored setting alone must not be presented as proof that an existing initialized client changed endpoint. Keep this distinct from the primary CLI process, which reads its environment at launch.

## Required proof before a wider release

1. Install the primary CLI plugin locally. Verify native CLI telemetry starts before the first model call and survives normal repeated sessions.
2. Exercise an approved Python script and CJS/ESM JavaScript script. Verify roots, exact outcome limits, safe metadata, and shared-run links. Add TypeScript loader cases to the published runtime matrix only after passing them.
3. In disposable project environments, test selected upstream HTTP/framework/database instrumentations, existing SDK conflicts, existing Python startup hooks, secret canaries, short-process flushing and measured overhead.
4. Upload one authorized filtered batch to the selected Azure route. Read it back with typed fields and privacy checks. Verify the actual native dashboard if that route is claimed.
5. Show separate recorder health, received native spans, observed scripts, dropped records, upload acceptance and cloud readback. None of those states proves task success or business value.

## Download inventory

The verified external storage had 331.86 GiB free. No dependency install or cloud write was performed.

- `otel/js`: shallow sparse source clone at `5bd1049ed3c3092b9bf9720b79660d427607b3f7`; main auto-instrumentation package, startup code and package metadata read.
- `otel/python`: shallow sparse source clone at `2d9c5d05ee8c4944a130ceecdea67f036d1b3982`; startup instrumentation and selected framework/asyncio packages read.
- `otel/official-docs`: selected official Markdown and Microsoft Learn HTML. `manifest.json` records source URLs, byte counts and SHA-256 hashes. `pinned-sources.json` records the exact raw-document source commits used above.

All downloads are beneath `/Volumes/SanDisk Archive/Agent-Workspace/workspaces/copilot-native-docs-20261003/otel`. No whole Azure SDK monorepo was cloned. Current local source inspection used Graphify `affected preload`; it found the exporter conversion and flush functions. `scoped-autos` had no unique graph match, so exact source search was used. No project graph files were changed.
