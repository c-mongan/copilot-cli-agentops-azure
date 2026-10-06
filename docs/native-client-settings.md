# Native client settings

The extension uses native Copilot OpenTelemetry. It does not require the
AgentOps CLI. The CLI is the primary client. VS Code Chat is a secondary client
with a separate reload requirement.

```text
Connect or Companion start
  -> claim one private local owner
  -> start the stable loopback Collector
  -> save owned settings before changing them
  -> set native Copilot export and new-terminal environment
  -> receive and filter local OTel data
Disconnect
  -> stop capture
  -> restore only values still owned by AgentOps
```

## Copilot Chat settings

The adapter requires these registered Copilot Chat settings. A setting is
accepted only when `inspect(key).defaultValue !== undefined`.

| Setting | Value |
| --- | --- |
| `github.copilot.chat.otel.enabled` | `true` |
| `github.copilot.chat.otel.exporterType` | `otlp-http` |
| `github.copilot.chat.otel.protocol` | `http/json` |
| `github.copilot.chat.otel.otlpEndpoint` | `http://127.0.0.1:4318` or the saved loopback port |
| `github.copilot.chat.otel.captureContent` | `false` |
| `github.copilot.chat.otel.captureIdentity` | `false` |

The endpoint must be a literal `http://127.0.0.1:port`. HTTPS, host names,
query strings and non-loopback addresses are rejected.

If all six Agent Host keys are registered, the adapter sets the matching
`chat.agentHost.otel.*` family. If any key is absent, it skips that complete
family. Chat and new CLI terminals can still connect. The installed VS Code
Insiders release rejects the hidden Agent Host protocol and identity keys, so
Agent Host capture is not qualified in that release.

The settings API can report effective values without proving that Chat emitted
a span. The installed Chat client fixes its active export configuration at
startup and can require a VS Code reload. Status must show **Chat reload
required** until the reload and a real receipt are observed. A local Collector
socket or configured setting is not a Chat-capture proof.

## Ownership and lifecycle

The adapter claims one private owner per VS Code profile. It writes a durable
`native-state.json` record before the first Global setting update. The record
contains only the old values of settings that AgentOps owns and the stable
Collector endpoint.

Connect stops for a missing setting, managed policy, conflicting workspace or
language setting, or conflicting telemetry environment variable. It does not
print environment values. Privacy controls are written before routing settings;
export is enabled last.

Routine host shutdown stops the local Collector but retains the opted-in state,
owned startup settings and endpoint. The next trusted local start can restart
the Collector at the same endpoint. Explicit Disconnect clears the terminal
environment and restores a setting only when its Global value still equals the
value AgentOps wrote. Later user or administrator changes stay in place. An
incomplete restore keeps its recovery record for a later attempt.

## Copilot CLI terminals

For a new integrated terminal, `nativeTerminalEnvironment(endpoint)` sets:

```text
COPILOT_OTEL_ENABLED=true
COPILOT_OTEL_EXPORTER_TYPE=otlp-http
COPILOT_OTEL_ENDPOINT=http://127.0.0.1:4318
COPILOT_OTEL_CAPTURE_CONTENT=false
COPILOT_OTEL_CAPTURE_IDENTITY=false
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

The CLI uses `OTEL_EXPORTER_OTLP_ENDPOINT`; it does not use
`COPILOT_OTEL_ENDPOINT` as its only endpoint. The Companion uses the same
settings in a newly opened terminal on macOS and Windows. It clears inherited
`OTEL_*` and `COPILOT_OTEL_*` variables only in that child launch before
setting the approved values.

The headless Windows qualification passed with Copilot CLI 1.0.91, VS Code
1.140.0/Node 24.21.0 and Collector 0.151.0. It produced four native spans in
one trace and removed the owner process and lease. Desktop Windows install,
normal-user ACLs, rendered GUI use and uninstall remain unqualified.

Existing terminals and external terminals are not changed. Device-wide
ordinary-terminal coverage requires an administrator-controlled Copilot
managed policy. This preview does not install that policy, a shell hook, a
launch daemon, or automatic startup.

## Selected project scripts

**AgentOps: Trace selected project script** prepares one approved Python or
Node launch. It requires a selected interpreter and project packages for the
selected OTel library mode. It supports separate CommonJS and ESM startup
paths. Compiled TypeScript is qualified only through a qualified runtime
loader. It does not install dependencies, inject all Python or Node processes,
collect script output, or trace every function.

Supported library spans include selected HTTP, framework and database
instrumentation. Internal business steps still need explicit spans. A run ID
joins receipts logically. It is not physical trace parentage unless the client
actually propagates and extracts W3C trace context.

## Azure commands

Azure controls are separate from local capture:

1. Configure an approved destination in user settings.
2. Select **Enable Azure publishing** and complete Microsoft sign-in.
3. Select **Publish native metadata to Azure** manually.
4. Select **Disable Azure publishing** to stop later requests.

The destination is user-global, never workspace-scoped. Tokens are obtained
through the VS Code Microsoft authentication surface. No Azure CLI route is
used. Publishing projects native metadata to the existing Azure event path; it
does not publish full spans, prompts, code, arbitrary attributes, full
waterfalls, or generic library spans.

The configured daily limit is 1 byte to 16 MiB. It limits attempted bytes and is
not a financial cap. Disabling publishing revokes later work and aborts active
requests where possible; an accepted Azure request cannot be recalled.

A separate synthetic proof sent one 473-byte row through the embedded
publisher, received HTTP 204, acknowledged one row and matched all 63
maintained fields by typed cloud readback. It used a cached Azure CLI token as
the injected test credential. This qualifies the embedded transport and
synthetic schema only. Actual VS Code Microsoft authentication, tenant
consent, least-privilege RBAC and the no-Azure-CLI user flow remain
unqualified.

## Local limits and proof

The combined receipt and Collector log is sampled for a 12 MiB stop threshold.
A burst can exceed that threshold before the next one-second check. Retained
storage is refused at 32 MiB or 4,096 receipt entries. No retained file is
deleted automatically. Receipt reports read at most 16 MiB.

The strict filter removes content and identity fields. It also scrubs scope,
schema URL and trace-state fields, and drops linked spans and exemplar points.
Those drops reduce coverage. The filter is not a general secret detector.

Installed Copilot CLI 1.0.91 produced four native spans through the strict
Collector with a local synthetic provider. The packaged macOS Companion
received the same shape and rendered a four-span report. The headless Windows
qualification also produced four spans in one trace and passed canary
filtering. These results prove local receipt and filtering only. They do not
prove paid-model quality, desktop Windows use, ordinary-shell activation,
complete Chat capture, the VS Code Azure sign-in flow or task outcome.

Run the focused settings checks with:

```sh
node --test extensions/agentops-native/test/native-settings.test.js
```
