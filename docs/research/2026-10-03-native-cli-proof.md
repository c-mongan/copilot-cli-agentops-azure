# Native Copilot CLI receipt qualification

On 2026-10-03, installed Copilot CLI **1.0.91** emitted real native OpenTelemetry data through the actual strict Collector **0.151.0**. The model provider was a local synthetic HTTP fixture. No GitHub model, provider credential, Azure service or paid model was used.

```text
Real Copilot CLI 1.0.91
  ├─ local synthetic model → fixed printf tool → synthetic reply
  └─ real native OTLP → loopback evidence proxy → strict Collector → local receipt
```

Run `node scripts/qualify-native-cli.js` to repeat this qualification on this Mac. The script uses installed `/opt/homebrew/bin/copilot` and `~/.agentops/collector/bin/otelcol-contrib`. Its exported `qualify` function also accepts explicit binary paths. It does not install dependencies.

The script creates a private temporary directory and a separate `COPILOT_HOME`. It enables `COPILOT_OFFLINE=true`, points BYOK to a loopback OpenAI-compatible fixture, and does not inherit provider, GitHub or exporter credential variables. It disables built-in MCP servers and custom instruction loading. Only `bash` is visible to the model; only the `shell(printf)` permission is approved. It does not use blanket tool, path or URL permission.

The fixture returns one fixed `bash` invocation, `printf agentops-native-fixture`, and then a fixed reply. A second request contains the marker in the tool result. This proves that the tool ran; a requested tool span alone is insufficient evidence.

| Check | Actual result |
|---|---|
| CLI exit | 0 |
| Provider requests | Two local `/v1/chat/completions` requests |
| Native spans after runtime exit and Collector shutdown | Four |
| Native operations | One `invoke_agent`, two `chat`, one `execute_tool` |
| Trace structure | One trace; all chat/tool spans have the agent span as parent |
| Tool execution | Fixed marker present in the second provider request's tool result |
| Prompt/response content capture | Disabled |
| Intentional resource privacy canary before filtering | Observed in actual native trace and metric exports |
| Canary after strict filtering | Absent from the complete receipt |
| Shutdown | CLI completed; real Collector received SIGTERM and drained its receipt |

The loopback proxy retains only byte counts and canary-presence flags. It forwards native OTLP unchanged to the Collector. The canary is put in an unapproved resource attribute. Thus the result tests actual privacy filtering, rather than only the absence of content when content capture is disabled. Synthetic prompt and response also contain the canary; the script checks that the runtime's response includes it. It does not save unfiltered export payloads.

Final artifacts:

- `/var/folders/gq/_5ytx8vs18xbh18m_k3n29ym0000gp/T/agentops-native-cli-Ar3MVg/qualification.json`
- `/var/folders/gq/_5ytx8vs18xbh18m_k3n29ym0000gp/T/agentops-native-cli-Ar3MVg/collector/run-AhbzRb/native-receipt.jsonl`
- Collector config and log are in the same private Collector directory. The temporary Copilot home contains synthetic local session state. No normal user profile was changed.

The focused checks in `scripts/test/qualify-native-cli.test.js` test credential exclusion, required operation detection, physical parent links, complete-receipt canary detection, invalid-receipt rejection and external scope restrictions. All four tests pass.

An initial run used `shell` as the availability name and received no tool definitions. It emitted real agent/chat spans but failed the tool gate. Official CLI docs use `bash` for availability and `shell(...)` for permissions. Correcting these separate names produced the qualified result above.

This establishes native CLI capture on the installed macOS runtime, with a synthetic model and real safe tool execution. It does **not** establish GitHub-hosted model quality, subagent traces, VS Code Chat lifecycle behavior, automatic installed-companion activation, Azure delivery, Windows/Linux behavior or human diagnostic benefit. No such result is inferred from this test.

## Actual installed companion Collector

The parent used computer control to launch the packaged macOS companion in isolated storage and clicked Connect. Its actual Collector was running at `http://127.0.0.1:4318`. A second qualification used this existing Collector, rather than starting the script's own Collector.

The exported `qualify` function accepts the pair `{ collectorEndpoint, receiptPath }`. It permits only an explicit HTTP IPv4 loopback endpoint and a private regular receipt file owned by the current user. The adjacent strict Collector config must contain the matching HTTP binding. The script reads at most 16 MiB per receipt and polls for at most 15 seconds. It measures only newly appended rows for span counts and checks the complete receipt for the privacy canary. It never stops a supplied Collector.

Actual result: CLI exit 0; four newly received native spans; one trace; all child spans link to the agent; the fixed tool result is present; the canary is observed in native trace and metric exports before filtering and absent from the complete installed-companion receipt. `passed=true` and `collectorStopped=false`.

- Qualification: `/var/folders/gq/_5ytx8vs18xbh18m_k3n29ym0000gp/T/agentops-native-cli-VvO1bT/qualification.json`
- Companion receipt: `/var/folders/gq/_5ytx8vs18xbh18m_k3n29ym0000gp/T/agentops-companion-gui-9hmqlf47/receipts/run-xsMg08/native-receipt.jsonl`

This additional proof establishes that the actual packaged companion's Collector accepts and filters real native CLI exports. The fixture still supplies pre-start telemetry variables to its isolated runtime. It does not prove that an ordinary user shell inherited them automatically. Companion GUI disconnect and final receipt persistence are separate parent checks.
