# AgentOps native capture preview

AgentOps uses Copilot's native OpenTelemetry (OTel) export. Copilot CLI is the
primary target. VS Code Copilot is the secondary interface.

The preview has two local entry points:

- Install the VSIX in VS Code and use the AgentOps commands.
- Open the packaged Native Companion and use its local control page. The
  Companion starts Copilot in a new terminal with private startup settings.

Users do not need an AgentOps CLI, a separate Node.js runtime, npm, Python,
Docker, or Azure CLI. The VSIX uses the VS Code runtime. The macOS Companion
also uses the installed VS Code runtime and does not require an editor window
to be running. The headless Windows native qualification passed on Windows
Server 2025. Desktop Windows installation, normal-user ACLs, rendered GUI use
and uninstall remain release gates.

## Local capture

Open a trusted local workspace and select **AgentOps: Connect native capture**.
AgentOps starts a checksum-verified local OTel Collector at a fixed loopback
endpoint, normally `http://127.0.0.1:4318`. It keeps the endpoint across a
normal VS Code restart and reconnects after an earlier opt-in. A private
profile lease allows one owner per profile. Remote and untrusted workspaces are
blocked.

When Insiders runs Chat in the local Agent Host, Connect also writes the
`chat.agentHost.otel.*` settings and restarts the local Agent Host. That restart
reuses the settings the VS Code main process has already loaded. If new Chat
turns add no spans, quit and reopen VS Code. This is needed when VS Code cannot
watch the user-data folder, for example on an external or network volume.

If the pinned Collector is missing, the VSIX downloads the official release
into private extension storage. A system `tar` program and network access to
the official GitHub release are required for that first download.

Use **AgentOps: Start Copilot terminal** or open a new integrated terminal.
Only that new terminal receives the Copilot OTel environment. Existing and
external terminals are unchanged. Ordinary terminals need an administrator's
Copilot managed policy. The standard `OTEL_*` variables can affect other
instrumented programs launched in a prepared terminal.

Use **AgentOps: Open local report** to view observed counts. The report shows
metadata and numeric token totals only. It does not show prompts, responses,
tool arguments, paths, URLs, source names, identities, or conversation IDs.
Capture coverage and task outcome remain unknown when data is missing.

The local output monitor samples the combined receipt and Collector log at a
12 MiB stop threshold. A burst can overshoot the sampled threshold. Retained
local storage is checked at 32 MiB or 4,096 receipt entries. AgentOps does not
delete retained receipts automatically. Review them before restarting after a
limit.

## What has been proved

Installed Copilot CLI 1.0.91 emitted four native spans through the strict
Collector: one agent span, two chat spans and one tool span. The model was a
local synthetic provider, and the tool ran a fixed `printf`; no paid model or
GitHub-hosted model was used. The packaged macOS Companion accepted the same
native export at port 4318 and rendered a report with four spans, one session,
24 input tokens and 10 output tokens. Disconnect closed the listener. Quit
closed the Companion server. The historical v3 screenshot is
`<agent-workspace>/artifacts/native-build-20261003/companion-v3-report.png`.

The headless Windows qualification run `37149760874` used Copilot CLI 1.0.91,
VS Code 1.140.0/Node 24.21.0 and Collector 0.151.0. It produced four spans
in one trace, passed capture and tool qualification, removed the canary after
filtering, exited the launcher with code 0, and removed the owner process and
lease. It used a synthetic local provider and made no paid model request.
This does not qualify the Windows desktop GUI, normal-user ACLs,
installation/uninstallation or sign-in.

This proves local native receipt and filtering. It does not prove GitHub model
quality, automatic ordinary-shell setup, Azure user authentication or complete
VS Code Chat capture.

## VS Code Chat and scripts

The extension configures registered Copilot Chat OTel settings with content and
identity capture off. The installed Chat client can require a VS Code reload
before a changed endpoint takes effect. Status therefore reports **Chat
unverified** or **Chat reload required** until a receipt is observed. Agent
Host capture is optional and remains unavailable when its complete setting
family is not registered.

Use **AgentOps: Trace selected project script** for one selected Python,
CommonJS, ESM or supported Node project launch. The command requires a selected
interpreter and project OTel packages where the selected mode needs them. It
does not install packages, add a global hook, trace every process, collect
script output, or promise every TypeScript loader. Compiled TypeScript is
qualified only when its runtime loader is qualified. The existing script
observer is scoped to approved launches and records a run ID; a run ID is a
logical link and does not prove a physical parent trace.

## Azure controls

Azure publishing is off by default. Use the user-level Azure destination
setting, then select **AgentOps: Enable Azure publishing** and sign in with
Microsoft authentication. **Publish native metadata to Azure** is a manual
operation. It sends the approved native metadata projection only; it does not
send prompts, code, arbitrary names, full waterfalls, or generic library spans.
This path does not use Azure CLI.

The daily publishing setting accepts 1 byte to 16 MiB. It is a byte budget, not
a financial cap. Disabling publishing aborts later requests, but cannot recall
bytes already accepted by Azure. A separate synthetic proof sent one 473-byte
row through the embedded publisher, received HTTP 204, acknowledged one row
and matched all 63 maintained fields by typed cloud readback. It used a cached
Azure CLI token as the injected test credential. This does not qualify the
VS Code Microsoft provider, tenant consent, least-privilege RBAC or the
no-Azure-CLI user flow.

## Disconnect and shutdown

**AgentOps: Disconnect native capture** stops the Collector and restores only
settings that still contain AgentOps values. Later user or administrator
changes are preserved. It clears the new-terminal environment for later
terminals; an existing terminal keeps its already-created environment.

Routine VS Code shutdown stops the local Collector but keeps the opted-in
startup settings and endpoint so the next trusted local start can reconnect.
Explicit Disconnect is the restore action. No launch daemon, shell profile,
root policy, code signing, or automatic system startup is installed by this
preview.

## Current reviewable artifacts

- macOS Companion v5: `<agent-workspace>/artifacts/agentops-native-companion-macos-v5/`
- Windows Companion v5: `<agent-workspace>/artifacts/agentops-native-companion-windows-v5/`
- Qualified v4 VSIX: `<agent-workspace>/artifacts/agentops-native-vsix-qualified-v4/agentops-local.agentops-native-0.1.0.vsix`
- v5 manifest: `<agent-workspace>/artifacts/agentops-native-package-manifest-v5/artifact-manifest.json`
- Windows summary: `<agent-workspace>/artifacts/native-build-20261003/windows-ci-final-summary/windows-qualification.json`

The v5 outputs are unsigned preview packages. The historical v3 Mac flow is
the rendered UI proof; the exact v5 ZIP outputs were not claimed as executed.
