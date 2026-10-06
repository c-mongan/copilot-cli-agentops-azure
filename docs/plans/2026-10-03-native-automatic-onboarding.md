# Native automatic capture without an AgentOps CLI

## User requirement

Support Copilot CLI and VS Code Copilot. Use native OpenTelemetry wherever possible. Users must not need to install the AgentOps CLI, write logging code, or run an AgentOps command. Keep setup simple and keep the existing local privacy boundary.

## Design

```text
One Connect control in VS Code
       |
       +-- native Copilot Chat settings
       +-- native Agent Host settings, where supported
       +-- native Copilot CLI settings in new integrated terminals
                       |
             strict local OTel collector
                       |
             private sanitized receipt
                       |
              status and local report
```

The extension uses VS Code's Node runtime. It includes the required existing recorder helpers and privacy configuration. If no pinned collector is present in the private extension storage, Connect downloads the pinned official collector release and checks its checksum. It does not install the AgentOps CLI, Node, npm, Docker, hooks or a shell wrapper.

Connect stores a restore record before it changes settings. Disconnect restores only values that the extension still owns. Changes made by the user or an administrator stay in place. The extension starts again only after a previous Connect choice. Remote or untrusted workspaces do not start local capture.

The extension shows collector health separately from actual received telemetry. A healthy collector does not prove capture. Native spans supply model, token and tool evidence. Coverage remains unknown. The report excludes prompt content, tool arguments, file contents, identity and private paths.

## Terminal scope

New VS Code integrated terminals can receive native environment settings. Existing terminals must be restarted. The standard OTEL variables can affect other instrumented programs in that terminal; setup must show this scope. External terminals are not changed. Copilot does not document a personal config.json telemetry setting. The supported full-device route is an enterprise managed telemetry policy. Prepare its documented form; do not install or change an operating-system policy in this task.

## Work and acceptance

1. Verify client settings against official documentation and the installed versions.
2. Build the reversible native-settings adapter and focused conflict/restore tests.
3. Build extension Connect, Disconnect, Status, Open Report and Copilot Terminal controls. Test collector failure, restart and receipt preservation.
4. Create an installable VSIX with only required source and runtime assets. Test it after removal of its disposable source checkout.
5. Run real local collector qualification with JSON/protobuf fixtures and a secret-like canary. Use a separate VS Code test profile for rendered UI checks. Do not change the user's normal profile or invoke a paid model.
6. Review the changes independently. Record actual client, collector, fixture and user-interface proof separately. Keep production publication and live private data onboarding out of this task.

## Decisions

- Use a VS Code extension instead of a new desktop application. It supplies a known install control and an existing runtime.
- Keep the collector local. Native metadata defaults are useful, but they do not replace the strict filter.
- Use native HTTP export. Use an explicit protocol supported by each client.
- Keep cloud publishing off. Existing Azure delivery authorization and identity checks remain separate.
- Do not claim that external terminals are configured by an editor extension. Enterprise policy is required for that managed-device route.

## Evidence

Research confirmed Copilot CLI 1.0.91, VS Code Insiders 1.141.0-insider and Copilot Chat 0.69.2026100103 on this host. Configuration support does not prove that these clients emitted a new trace. No model request was made during research.

Primary sources: [Copilot native OTel](https://docs.github.com/en/copilot/concepts/enterprise/opentelemetry), [VS Code agent monitoring](https://code.visualstudio.com/docs/agents/guides/monitoring-agents), [enterprise settings schema](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings).

## Qualification change

The real extension API in VS Code Insiders 1.141.0-insider rejects the hidden Agent Host protocol and identity settings. The extension skips that entire optional family. It still configures all six Copilot Chat settings and new integrated CLI terminals. A private profile lease prevents two windows from changing the same Global settings. A private durable record supports settings recovery after a host crash.
