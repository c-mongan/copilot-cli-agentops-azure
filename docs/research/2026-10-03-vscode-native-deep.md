# VS Code native telemetry: deep source review

Date: 2026-10-03. Scope: official VS Code documents, Copilot Chat source, VS Code Agent Host source, and the installed Copilot Chat bundle. This review changes no user settings, model sessions, cloud resources, or product code.

## Result

Copilot CLI should be the primary capture target. VS Code can be a setup and report interface. Native telemetry already supplies useful agent, model, token, tool, and subagent spans. It does not instrument the internals of each Python or JavaScript program that an agent starts. Application instrumentation remains a separate process-start capability.

**The existing extension has a material Chat lifecycle gap.** Its local fixture tests do not prove live Copilot Chat export. Chat reads its export configuration at startup and requires a reload for endpoint and enablement changes. AgentOps currently restores those settings and stops its Collector on extension shutdown, then selects a new endpoint on restart. This can leave Chat disabled or pointing at a dead endpoint. New integrated CLI terminals receive fresh variables independently, so the CLI environment path is a different proof boundary.

## Sources saved for local reading

Disposable clone root: `<agent-workspace>/workspaces/copilot-native-docs-20261003/vscode`.

| Repository | Pinned commit | Scope |
| --- | --- | --- |
| microsoft/vscode-docs | `35e82eeecd596e95917037b296b1c83fb4a6be64` | Agent and enterprise documentation; sparse checkout |
| microsoft/vscode-copilot-chat | `5863f5a7088958050792b5dccbe8b46c6e13eccc` | Source and upstream tests; shallow clone |
| microsoft/vscode | `45373f06ff77cc97a7754a376548d8937fb3af54` | Agent Host, telemetry, chat, extension API source; sparse checkout |

The Chat source commit date is 2026-05-20. The VS Code source commit date is 2026-10-03. The installed artifact is Copilot Chat `0.69.2026100103`, bundled with VS Code Insiders `1.141.0-insider`. Its package records VS Code commit `94c8e2adc50e26ef70af85a0de3a9efed757acaa`. The older public Chat checkout is not a full source match for the installed bundle. Main branch, current documentation, and installed binaries must not be treated as the same release.

No fresh Graphify graph exists for these clones. This read-only review used exact source searches and did not create graph files.

## Support matrix

| Execution path | Native telemetry path | Coverage and limitation |
| --- | --- | --- |
| Local Copilot Chat extension | Native Chat OTel service | Agent roots, model calls, tools, tokens, metrics and events. Requires supported settings and startup configuration. Live emission remains unverified locally. |
| Copilot SDK session inside the Chat extension | Native SDK spans plus extension wrapper | Wrapper context is passed to the SDK. It can produce a connected hierarchy. This is distinct from a terminal process. |
| New Copilot CLI terminal created by VS Code | Native CLI OTel environment | Separate process and independent root traces. Native VS Code forwards enablement and endpoint. Existing external shells do not receive these variables. |
| New terminal created after AgentOps Connect | AgentOps environment collection, then native CLI | Existing tests prove environment inheritance. They do not prove a real model turn emitted spans. |
| VS Code Agent Host local/background session | Agent Host translates settings/policy into native provider configuration | A separate host can outlive an editor. Hidden protocol and identity slots are policy-only. The installed extension API qualification rejects these slots. Do not enable this path by guessing settings. |
| Remote host / SSH / Dev Container | Host-side instrumentation and Collector | Loopback refers to the execution machine. A local desktop Collector cannot receive remote loopback export without an explicit transport design. Existing AgentOps extension blocks remote workspaces. |
| Cloud coding agent | Service-controlled runtime | Local extension settings do not prove control of remote service telemetry. Separate service support is required. |
| Python / TS / JS launched by a tool | Native tool span only, unless application instrumentation is installed | A tool span measures the command boundary. It does not create spans inside arbitrary application libraries or propagate one trace into every child process. |

The source paths that establish these distinctions are [Chat SDK session setup](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/extension/chatSessions/copilotcli/node/copilotcliSessionService.ts), [wrapper trace context](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/extension/chatSessions/copilotcli/node/copilotcliSession.ts), and [Agent Host provider setup](https://github.com/microsoft/vscode/blob/45373f06ff77cc97a7754a376548d8937fb3af54/src/vs/platform/agentHost/node/copilot/copilotAgent.ts).

## Native signals and protocol

The public Chat implementation uses a Node trace provider, batch span processor, log provider, and periodic metric reader. It exports HTTP signals to `/v1/traces`, `/v1/logs`, and `/v1/metrics`. Its HTTP imports are the JSON OTel exporters; its gRPC path uses separate gRPC exporters. It supplies no custom sampler in the provider constructor. Do not assume Collector filtering or sampling proves all spans were captured. See [OTel service implementation](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/platform/otel/node/otelServiceImpl.ts).

The installed newer Chat package registers `github.copilot.chat.otel.protocol` with `http/json`, `http/protobuf`, and `grpc`, plus `captureIdentity`, service name, resource attributes, and exporter headers. The older public Chat package has neither `protocol` nor `captureIdentity`. Capability discovery must therefore use the running extension API and installed package, rather than a universal six-key list. The installed description says an empty protocol selects JSON. Explicit JSON is suitable for the qualified local path; the shared Collector should also accept HTTP protobuf from other clients.

Native token metrics and model-call spans can support cost and latency reports. Agent-root spans can also carry total tokens. Sum unique model-call spans, not both roots and children. Upstream names include `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, tool call count/duration, and time to first token. See [metrics source](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/platform/otel/common/genAiMetrics.ts) and [attribute constants](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/platform/otel/common/genAiAttributes.ts).

## Settings, precedence, and privacy

The older Chat resolver gives Copilot-specific endpoint environment variables priority over the standard endpoint and personal settings. The actual source gives `OTEL_EXPORTER_OTLP_PROTOCOL` priority over `COPILOT_OTEL_PROTOCOL`; the current monitoring document describes the reverse order. Prefer installed source and effective runtime values where they disagree. The installed package says standard protocol env first, then Copilot protocol env, then managed/personal settings. See [public resolver](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/platform/otel/common/otelConfig.ts).

The installed artifact supports managed identity denial and immediate identity suppression, but endpoint or enablement changes still require a restart. Its resolver freezes the process environment when constructed. Changes in an already running shell or extension's terminal collection do not reconfigure the Chat process.

The resolver contains a `vscodeTelemetryLevel === 'off'` guard. However, the public startup call does not supply this input, and the installed minified bundle contains only the guard occurrence. It is **not proved** that setting `telemetry.telemetryLevel=off` disables native OTel in these artifacts. A unit test that calls the resolver with that input does not establish actual startup behavior.

Current VS Code source makes `chat.agentHost.otel.otlpProtocol` and `chat.agentHost.otel.captureIdentity` hidden policy delivery slots (`included: false`). They are not ordinary extension-writable user controls. Managed protocol translation overrides inherited per-signal protocol variables. Host-side policy and shell precedence differ from Chat. Managed auth headers are deliberately not forwarded into tool subprocess environments. See [registered configuration](https://github.com/microsoft/vscode/blob/45373f06ff77cc97a7754a376548d8937fb3af54/src/vs/platform/agentHost/common/agentHostStarter.config.contribution.ts), [host environment builder](https://github.com/microsoft/vscode/blob/45373f06ff77cc97a7754a376548d8937fb3af54/src/vs/platform/agentHost/common/agentService.ts), and [host technical guide](https://github.com/microsoft/vscode/blob/45373f06ff77cc97a7754a376548d8937fb3af54/src/vs/platform/agentHost/OTEL.md).

Content capture off is necessary, but it does not replace the existing strict local filter. Session IDs, repo metadata, resource attributes, free-form error fields, and tool names need an explicit storage/export policy. Native debug-panel capture and native OTLP export are also different sinks. The older SDK session service enables internal tracing for its debug panel even when external export is disabled.

## Chat lifecycle defect: exact evidence

Installed file: `/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/copilot/dist/extension.js`.

1. `Klt` (`OTelConfigResolver`) assigns `activeResolution` and current resolution at construction. Its configuration-change callback updates current resolution and narrows allowed identity capture. It does not replace the active export service.
2. `OTelContrib._watchForReloadRequiredChanges` creates a configuration watcher. For personal changes, its prompt says: `Copilot OTel settings changed - a reload is required for the change to take effect.` Endpoint changes get a destination-specific reload prompt.
3. The contribution's terminal environment setup reads the active service configuration. It runs at construction. This separate native environment collection can retain an old endpoint while AgentOps writes a new one.
4. AgentOps `src/extension.js` calls `stop(false)` during dispose. That function calls `disconnectNativeSettings`, restores original values, and stops the Collector. Connect later restores stale state and starts a Collector at a newly allocated port.

This is source-level defect evidence. A model call is not needed to show the ordering conflict. The exact observed native outcome still requires an isolated real client test. Do not describe prior synthetic payload delivery or API settings tests as successful Chat capture.

Required correction: keep an opted-in endpoint stable across host restarts; preserve the owned native settings during routine host shutdown; restore settings only on explicit Disconnect or failed Connect rollback. The Collector must either restart at the same endpoint before Chat uses it or run as a separately managed local service. Show `Reload required` until the client uses that configuration. Use receipt evidence to report observed capture. A source flag or open socket is insufficient.

## Minimum shared architecture

```text
Copilot CLI (primary) ─── native OTel ──────┐
VS Code Chat / Agent Host ─ native OTel ───┤
Approved Python / JS process bootstrap ───┤
                                         v
                            Stable local Collector
                            Strict signal filtering
                            Bounded private queue
                                         v
                           Authenticated Azure delivery
                                         v
                             Azure reports / local UI
```

Use a stable local Collector and a CLI-first installer or supported managed policy. A VS Code extension should control the same capture service and show receipt status. It should not be the required lifetime owner for external CLI sessions. Python and JS bootstrap must be explicit, reversible, and limited to selected environments. Do not insert runtime hooks globally or claim full application instrumentation from OTel variables alone.

The official [monitoring guide](https://code.visualstudio.com/docs/agents/guides/monitoring-agents) describes an Azure Monitor Collector exporter route to Application Insights. The existing product also has its own Logs Ingestion custom-table route. Those are different data contracts and reports; connecting an OTLP endpoint directly to a DCR URL does not convert OTLP to Logs Ingestion rows. Choose one first to keep cost and support work small. Preserve the local filter and keep Azure credentials outside client/tool environments.

## Tests read; tests not run

Upstream tests cover configuration resolution, trace context, span hierarchy, metrics, and CLI environment derivation. Current VS Code has a managed Copilot telemetry end-to-end suite with a local receiver and a replay harness: [suite source](https://github.com/microsoft/vscode/blob/45373f06ff77cc97a7754a376548d8937fb3af54/src/vs/platform/agentHost/test/node/e2e/providers/copilotOtelAgentHostE2E.integrationTest.ts). These are upstream test definitions, not local passing results. This research did not install dependencies, run upstream tests, request model turns, or contact Azure.

Before a complete-support claim, test a real CLI model turn, a real Chat turn after reload, a terminal after restart, disconnect restoration, host shutdown, supported policy behavior, and Python/JS instrumented child programs. Use content and identity canaries. Prove every selected Azure signal with readback. Keep unsupported remote and policy-only paths visible.
