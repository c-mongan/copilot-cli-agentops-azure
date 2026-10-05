# Copilot SDK native telemetry research

Date: 2026-10-03. Scope: official SDK docs, implementation, released types, and upstream test contracts. This is source research. No model call, authentication check, cloud write, dependency install, or live export test was run.

The SDK supports native telemetry for the runtime that it starts. It does not automatically trace all Python or JavaScript application code. A plugin inside an existing Copilot CLI session cannot set the parent CLI's startup environment.

```text
Application launch
  -> language OTel setup, if enabled
  -> SDK TelemetryConfig
  -> spawned Copilot runtime with native OTel enabled
  -> local privacy Collector
  -> separately configured Azure delivery
```

## Source and version evidence

The official shallow clone is `/Volumes/SanDisk Archive/Agent-Workspace/workspaces/copilot-native-docs-20261003/sdk`. Its HEAD is `ef04633cc84e4ba8e79888a39259ca276f5de732`. No upstream files were edited. No Graphify graph exists in this new clone, so inspection used exact source and docs paths without creating a graph.

The release tag `v1.0.14` was also fetched. It resolves to `e60d9037353249ef16b349eb4012e8c1d113fda5`. The project's `evals/stockpilot/package-lock.json` and installed package both specify `@github/copilot-sdk` `1.0.14`, which pins runtime `1.0.85`. The new SDK HEAD pins `1.0.92-3` and uses development version placeholders. These are separate from the system Copilot CLI version. Do not claim HEAD-only APIs work in an older installed runtime. The existing AgentOps adapter's peer range `>=0.1.0 <2` is a compatibility declaration, not proof that every version exposes the current telemetry APIs.

## Native configuration and startup

`TelemetryConfig` exposes endpoint, HTTP protocol, exporter type, file path, source name, and message-content capture. Providing the object opts in. Use an explicit loopback endpoint, `http/json`, `otlp-http`, and `captureContent: false`. An empty object also enables telemetry and leaves exporter defaults in effect, so it is unsuitable for our explicit local privacy boundary.

The TypeScript `buildRuntimeEnv()` and Python process startup copy the selected environment and apply these fields before spawning the runtime. An explicit `env` replaces inherited environment; it is not an automatic merge. Config must be established before `start()` or an automatic first session start. Connecting to an existing external runtime does not restart it or rewrite its environment. The external server operator must configure telemetry at server startup. Sources: [released TypeScript types](https://github.com/github/copilot-sdk/blob/e60d9037353249ef16b349eb4012e8c1d113fda5/nodejs/src/types.ts), [released client](https://github.com/github/copilot-sdk/blob/e60d9037353249ef16b349eb4012e8c1d113fda5/nodejs/src/client.ts), [released Python client](https://github.com/github/copilot-sdk/blob/e60d9037353249ef16b349eb4012e8c1d113fda5/python/copilot/client.py).

Experimental in-process hosting shares the host environment. TypeScript and Python reject per-client `telemetry` and `env` options for that transport. Configure host-global values before native runtime initialization, or retain the child-process path. A child process gives simpler lifecycle and configuration isolation. Source: [in-process guide](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/docs/setup/in-process-runtime.md).

## Application and tool trace context

Python injects the current W3C trace context when OpenTelemetry is installed and restores inbound context around a tool handler. This establishes a parent for spans created by installed language instrumentation; it does not create spans for every line or function. The telemetry optional dependency supplies the OTel API, not a full application exporter or automatic library instrumentation.

Node.js has no OTel dependency. Applications supply `onGetTraceContext` for outbound calls and restore `ToolInvocation.traceparent` and `tracestate` around inbound tool handlers. Without this bridge, app and CLI spans need not share one trace. Configure the language tracer before application imports that it must instrument. Do not promise that a CLI plugin alone can instrument unrelated processes or already imported libraries. Sources: [telemetry guide](https://github.com/github/copilot-sdk/blob/e60d9037353249ef16b349eb4012e8c1d113fda5/docs/observability/opentelemetry.md), [Python helper](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/python/copilot/_telemetry.py), [Python tool dispatch](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/python/copilot/session.py), [Node session](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/nodejs/src/session.ts).

## Plugin and extension boundary

Plugins contribute skills, agents, hooks, MCP servers, and LSP servers. A host can pass `--plugin-dir` before runtime launch. It can also supply per-session plugin directories or register trusted host plugins after the protocol handshake. Those later registration APIs do not configure runtime OTel startup.

`joinSession()` is explicitly for an extension running as a child of Copilot CLI. It attaches to the foreground parent session. Its environment access feature grants selected parent values to the child; it does not grant a way to change the parent's environment. Therefore a native CLI plugin is useful for status, diagnosis, reports, and supplemental events, but a plugin-only automatic native telemetry bootstrap is not established by these SDK APIs. A launch setup or approved managed telemetry policy must precede it. Sources: [plugin directory guide](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/docs/features/plugin-directories.md), [extension implementation](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/nodejs/src/extension.ts).

## Runtime packaging, authentication, and usage

Node.js and .NET packages include platform runtime dependencies. Python can download and checksum-verify the matching runtime on first use; its explicit download step is recommended for predictable startup. This permits a packaged app with no separate global CLI installation. It does not instrument an unrelated interactive `copilot` process. Sign-in or a configured model provider is still required. A packaged SDK app must preserve permission handling and stop the owned runtime to flush exports. Sources: [bundled runtime guide](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/docs/setup/bundled-cli.md), [Python downloader](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/python/copilot/_cli_download.py), [authentication guide](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/docs/auth/authenticate.md).

Usage events expose per-call model, optional token/cache counts, latency, and billing data. They are ephemeral. Missing fields remain unknown. `cost` is documented as a model multiplier; it is not automatically a currency amount. Accumulated usage RPCs are marked experimental. Internal GitHub session telemetry controls are independent of exported OTel. Source: [usage guide](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/docs/features/usage-and-billing.md).

## Upstream evidence and required qualification

The inspected TypeScript and Python E2E tests require native `invoke_agent`, `chat`, and `execute_tool` spans, common trace IDs, tool call IDs, and child-agent span parentage. They stop the runtime before file readback. Their content-enabled fixture mode is not our privacy configuration. The unit mapping tests partly reconstruct field mappings rather than invoking process startup; they must not be presented as our end-to-end proof. Sources: [TypeScript E2E contract](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/nodejs/test/e2e/telemetry.e2e.test.ts), [Python E2E contract](https://github.com/github/copilot-sdk/blob/ef04633cc84e4ba8e79888a39259ca276f5de732/python/e2e/test_telemetry_e2e.py).

For delivery, qualify the exact released CLI and SDK versions with: native span reception, model/tool/token fields, Python and Node context joins, strict content canaries, child-process shutdown flush, and Azure typed readback. Keep generic application spans separate from the current Copilot allowlist until an explicit application schema and privacy test exist. The SDK docs do not define the Azure destination; local OTLP collection and Azure ingestion remain separate product responsibilities.
