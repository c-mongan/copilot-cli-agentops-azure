# Copilot CLI primary target: official documentation audit

TL;DR — Native Copilot CLI OpenTelemetry is supported in installed 1.0.91. The current VS Code package enables it in new integrated terminals. An ordinary terminal needs telemetry configuration before Copilot starts. A plugin hook cannot change its parent process environment. Native CLI extensions can supply useful session status and reports with the SDK already bundled in Copilot, but this path is experimental.

## Evidence and scope

Read on 2026-10-03. No model request, sign-in, update, installer execution, user setting change, Azure change, or production write was performed. This audit owns only this report and the external documentation copies.

> 🧠 **From Hindsight memory (AgentOps native automatic capture without CLI setup)** — The existing package covers Copilot Chat and new integrated terminals. Live client trace emission remains unverified. Source documentation was checked before accepting any wider coverage claim.

| Official repository | Snapshot | External copy | Size |
| --- | --- | --- | --- |
| `https://github.com/github/copilot-cli` | `a9ba11a191255b3f7b323b425b717f7db14b6c74`, committed 2026-10-01 | `/Volumes/SanDisk Archive/Agent-Workspace/workspaces/copilot-native-docs-20261003/cli/copilot-cli` | 600 KiB |
| `https://github.com/github/docs` | `2bd66de8cea336061c9ea060c9b37385136e6ab3`, committed 2026-10-02 | `/Volumes/SanDisk Archive/Agent-Workspace/workspaces/copilot-native-docs-20261003/cli/github-docs` | 11,464 KiB |

Both are depth-one, blob-filtered clones. The docs copy uses sparse checkout of `content/copilot` and `data/reusables/copilot`. The CLI repository contains public README, changelog, and installation script. It does not expose the CLI runtime source. The script was not executed. The official CLI README still describes older model defaults and premium-request accounting, so installed help and maintained references take priority for current behavior.

The installed executable `/opt/homebrew/bin/copilot` reports `GitHub Copilot CLI 1.0.91`. Its `--help`, `help monitoring`, `help config`, and `help environment` were read. The latter three outputs are retained under the external `cli/` directory. Current published command, hooks, plugin, extension, and SDK telemetry pages were also opened. This distinguishes published documentation from an unverified future branch.

Pinned primary references used below:

- [CLI reference snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/reference/copilot-cli-reference/cli-command-reference.md)
- [CLI configuration snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/reference/copilot-cli-reference/cli-config-dir-reference.md)
- [Managed telemetry schema snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/reference/enterprise-administrators/enterprise-managed-settings.md)
- [Managed deployment snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/deploy-managed-settings.md)
- [Hooks snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/reference/hooks-reference.md)
- [Plugin snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/reference/copilot-cli-reference/cli-plugin-reference.md)
- [Extension tutorial snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/tutorials/create-an-extension.md)
- [SDK telemetry snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/how-tos/copilot-sdk/observability/opentelemetry.md)

## Native CLI contract

Native telemetry is off by default. Installed help states that any of `COPILOT_OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT`, or `COPILOT_OTEL_FILE_EXPORTER_PATH` activates it. HTTP export accepts `http/json` or `http/protobuf`; JSON is the CLI default. Per-signal protocol variables override the general protocol. Unsupported protocols, including gRPC, warn and fall back. The default HTTP backend is `otlp-http`. File-path configuration automatically selects `file` only when exporter type is unset. Set exporter type explicitly in the product. See the CLI reference and installed monitoring receipt.

The minimum native HTTP configuration is:

```text
COPILOT_OTEL_ENABLED=true
COPILOT_OTEL_EXPORTER_TYPE=otlp-http
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<owned-port>
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

These values must be available to the Copilot process. They are not a documented personal `telemetry` property in `~/.copilot/settings.json` or legacy `config.json`. The user and repository schema tables contain no telemetry row; the managed schema contains it. Do not write an invented property and claim activation. Setting environment variables in a child hook or MCP process does not set the parent process environment. This final statement is a process-boundary inference, reinforced by the documented hook output contract.

Native output includes an `invoke_agent` span per agent invocation, `chat` spans per provider request, and `execute_tool` spans per tool call. Native subagent spans share trace context. This covers orchestration and the tool call boundary. It does not document Python or JavaScript script statements, database queries, or HTTP requests made inside an arbitrary shell command. A successful shell tool span does not establish task success. See the CLI reference trace tables.

Use unique `chat` spans for model-call token totals. Root `invoke_agent` token fields already aggregate its invocation. Summing both root and children counts usage twice. `gen_ai.request.model` is requested; `gen_ai.response.model` is resolved. Keep both. `github.copilot.cost` is a model multiplier, not a currency amount. The docs direct readers to the root `invoke_agent` span for `github.copilot.nano_aiu`, because child copies cause double counting. Exact GBP/EUR/USD cost still requires current billing rules and account-level attribution.

Metadata-only native output can still carry `enduser.pseudo.id`, server addresses, agent descriptions, and session identifiers. Content capture off is not the full AgentOps privacy boundary. Keep the local strict filter before file storage and Azure export. Native span events include hook, skill, cancellation, shutdown, compaction, and exception details. Some include paths or messages; allowlist accepted fields rather than forwarding each event verbatim.

Installed 1.0.91 help documents custom CA and mTLS variables. These only apply to HTTPS and the HTTP exporter. If TLS variables exist while the endpoint is HTTP, export is disabled rather than sent in clear text. Copilot continues, and warning visibility depends on process log level. This is a concrete reason to check conflicting inherited variables and prove receipt delivery instead of treating process health as capture proof. `NODE_EXTRA_CA_CERTS` does not configure the CLI's native Rust OTLP transport. The 1.0.91 changelog also records a bounded shutdown telemetry flush. See [release snapshot](https://github.com/github/copilot-cli/blob/a9ba11a191255b3f7b323b425b717f7db14b6c74/changelog.md).

## Plugin and extension limits

Plugins can package skills, agents, hooks, MCP configuration, LSP configuration, and Copilot-specific JavaScript extension directories. Native management supports install, list, update, enable, disable, and uninstall. A legacy manifest `extensions` property points to extension directories. In the Agent Plugins schema, top-level `extensions` means client-specific metadata instead; do not confuse these schemas. Pin a marketplace source to a full SHA for reproducibility. See the plugin snapshot.

No inspected plugin manifest field defines an install/uninstall script or a parent runtime telemetry configuration setter. Do not promise that `copilot plugin install` alone can start native OTel capture on every later ordinary-terminal run. A plugin can ship setup logic as an explicit component, but the resulting OS policy, shell setting, or background process remains a distinct effect with consent and rollback requirements.

The `sessionStart` hook returns only `additionalContext`; only that field is consumed. Hook `env` configures the hook command. `preToolUse` can return `modifiedArgs`, but it does not return a parent environment update or native trace context. A hook can modify an explicitly supported shell command to invoke an instrumentation wrapper. That changes execution semantics and needs narrow parsing, approval preservation, regression tests, and truthful coverage. Do not rewrite arbitrary shell syntax or claim that an `export` in a hook enables parent telemetry. Hooks can receive raw prompts, arguments, and results even when native metadata capture is off; discard those fields before any hook storage or upload. See the hooks snapshot.

Plugin/user/repository hooks run inside the session sandbox when it is enabled. Hook `cwd` and `env` do not add grants. Policy hooks run on the host and require administrator installation. Hook timeouts are fail-open even for `preToolUse` and policy hooks. A privacy guarantee must not depend on a hook always executing successfully. The built-in general-purpose agent does not emit subagent start/stop hooks; this is another reason to prefer native telemetry for agent relationships.

Native CLI JavaScript extensions use `joinSession` from `@github/copilot-sdk/extension`. Copilot supplies and resolves this bundled SDK. A separate npm SDK install is not needed for the tutorial path. Extensions are long-lived subprocesses. They can subscribe to `tool.execution_start`, `tool.execution_complete`, and `assistant.usage`, register slash commands, and print status through `session.log`. This provides a plausible CLI-first UI and an explicitly labelled event-based fallback. It is not native OTel activation. The feature is experimental, requires experimental features enabled, and can be disabled; disable stops extension processes. See the extension tutorial and [extension concepts snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/concepts/agents/copilot-cli/about-cli-extensions.md).

## Managed policy: widest native CLI coverage

Administrators can configure `telemetry.enabled`, `endpoint`, `protocol`, `captureContent`, `lockCaptureContent`, `serviceName`, `resourceAttributes`, and `headers`. Use `captureContent:false` and `lockCaptureContent:true`. The telemetry property supports CLI and VS Code. Deployment precedence is MDM, server-managed, file-based, then user-level settings. Do not assume that a lower-level local telemetry object merges every missing field into a higher-level object. Resolve the effective policy before activation.

Managed locations are:

```text
macOS:  /Library/Application Support/GitHubCopilot/managed-settings.json
Linux:  /etc/github-copilot/managed-settings.json
Windows: %ProgramFiles%\GitHubCopilot\managed-settings.json
```

On macOS/Linux the file must be regular, root-owned, and neither group-writable nor world-writable; no symlink. Use the stricter deployment requirements where another reference omits group-writable wording. Native MDM uses `com.github.copilot` forced preferences on macOS or `HKLM\SOFTWARE\Policies\GitHubCopilot` string values on Windows. Linux uses file delivery. Server policy refresh is about hourly; restart or sign-in triggers refresh. File delivery requires supported-client restart. Exact telemetry reinitialization under a changed running-session policy still needs an installed-version test. See managed schema/deployment and CLI configuration snapshots.

## Compatibility matrix

| Surface | Supported native activation | Current product proof | Remaining condition |
| --- | --- | --- | --- |
| Copilot CLI in a new owning VS Code terminal | Prelaunch native environment | Environment injection verified in prior report | Real CLI emission and privacy receipt proof |
| CLI in an already open VS Code terminal | Existing process environment or managed policy | Not enabled by creating a later extension environment collection | Open a new terminal or use effective managed policy |
| CLI in external Terminal, iTerm, Ghostty, or CI | Prelaunch environment or admin-managed telemetry | Native documentation and installed help only | CLI-first package/startup setup plus live receipt proof |
| CLI connected to VS Code through `/ide` | Same CLI-native configuration requirements | IDE context/diff link is documented | Do not treat IDE connection as inherited telemetry settings |
| Copilot Chat | Registered Chat settings or effective managed telemetry | Prior isolated API/settings proof | Live Chat emission and UI proof |
| VS Code Agent Host | Its own registered configuration family/effective policy | Prior installed family incomplete | Separate version qualification; do not include in current supported label |
| SDK-spawned CLI | Client `TelemetryConfig` or process environment | Documented SDK contract | Per-language/version E2E proof |
| CLI plugin session events | Experimental native JS extension subscriptions | Documentation only in this audit | Label event fallback separately; prove plugin lifecycle and privacy |
| Python/Node work launched by a tool | Separate runtime auto-instrumentation | No automatic native CLI contract found | Install relevant language instrumentation; prove context propagation |

CLI IDE auto-connection shares editor context, diagnostics, and diffs even from an external terminal. The [IDE integration snapshot](https://github.com/github/docs/blob/2bd66de8cea336061c9ea060c9b37385136e6ab3/content/copilot/how-tos/copilot-cli/use-copilot-cli/connecting-vs-code.md) does not document OTel environment transfer. Process location and IDE attachment are separate facts.

## CLI-first architecture recommendation

```text
Native prelaunch environment or administrator policy
                        |
                  ordinary copilot
                        |
             native OTel traces + metrics
                        |
             owned loopback strict Collector
                        |
             private sanitized local receipt
                        |
       local report + separately enabled Azure delivery

CLI plugin extension: status/report/consent controls
VS Code extension: same recorder + new-terminal settings
Python/Node adapters: supported runtime instrumentation only
```

Use the existing Collector, privacy rules, parser, and Azure typed schemas. Avoid another proxy, database, or gateway. For an unmanaged personal device, the current VS Code new-terminal launch path is the smallest already implemented no-extra-CLI route. For an enterprise's ordinary terminals, deploy a supported managed telemetry policy and an owned Collector service before users launch Copilot. A fixed loopback endpoint simplifies a managed policy; allocate one owner and enforce exclusive startup. Dynamic extension ports cannot be written into a static policy and assumed correct after restart.

An installable CLI plugin can add controls and report access with no separate AgentOps CLI. It cannot by itself remove the need for prelaunch native configuration. A bundled setup package can prepare per-user shell environment or administrator policy with explicit consent and conditional restore, but this is proposed work, not verified implementation. Prefer the managed policy route for enterprise deployment. Keep cloud authentication outside plugin source, plain headers, and trace resource attributes.

## Required proof before a CLI-primary completion claim

1. Run the exact installed CLI version against an owned loopback Collector. Prove a genuine native `invoke_agent`/`chat`/`execute_tool` sequence, resolved model, tool execution, token semantics, shutdown flush, and subagent relationship. A non-model help command may emit nothing; absence is not a native capture test.
2. Keep a synthetic content canary in a disposable test prompt/tool. Verify it is absent from filtered files, local report, and typed Azure readback. Do not reuse private session history as a fixture.
3. Verify direct plugin install, restart, experimental gating, disable, uninstall, duplicate sessions, changed configuration, sandbox denial, and owner crash. No stale Collector, credential output, or settings overwrite is acceptable.
4. For language adapters, prove supported Python and Node instrumentation against local fixtures. Confirm child spans share a proven parent trace; otherwise show them as separate traces or unavailable correlation.
5. For enterprise policy, prove effective configuration on each supported OS and client version. Confirm locked content capture cannot be re-enabled. Qualify TLS/env conflicts and managed precedence.
6. For Azure, prove each accepted schema field and multiplicity with a new native batch. Prior synthetic 97-row proof supports the ingestion contract, not live CLI capture or usefulness.
7. Observe a user diagnosing a real CLI failure from the report. Native metadata plus green tests does not establish that the product reduces diagnostic time.

This audit provides documentation and version evidence. It does not add native CLI live proof, OS release qualification, Azure native proof, or measured user value.
