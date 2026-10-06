# Supported runtime matrix

This matrix fixes the qualification targets for the October 2026 release candidate. Version pins describe targets, not a claim of complete compatibility. Keep package metadata, executable version, harmless lifecycle proof, live model execution and delivery proof separate.

| Surface | Pin | Qualification in this checkout |
| --- | --- | --- |
| Native Copilot CLI | 1.0.91 | Installed executable returned 1.0.91 with `--version` on macOS arm64. Existing skill/MCP intermittency remains documented in [verification](research/2026-10-02-agentops-verification.md); no fresh model qualification occurred here. |
| Standalone Copilot SDK | 1.0.16 | Release target, not installed under the adapter package on this host. The adapter's broad optional peer range is not version-specific qualification. |
| Vally CLI | 0.17.0 | Installed StockPilot package metadata matches. |
| Vally library | 0.17.0 | Installed StockPilot package metadata matches. |
| Vally's Copilot runtime | 1.0.85 | Installed StockPilot dependency metadata matches. This is a separate runtime from native CLI 1.0.91. |
| Vally's SDK | 1.0.14 | Installed StockPilot dependency metadata matches. It does not qualify standalone SDK 1.0.16. |
| AgentOps Node host | >=20 | Local lifecycle checks ran on Node 22.23.0, macOS arm64. Other Node majors require their own run. |
| Python interpreter | Direct owned script commands | Host `python3 --version` reports 3.14.6. Interpreter presence alone does not establish Python tracing. |

The version targets come from the repository's [dated platform research](research/2026-10-02-current-platform-research.md) and the exact StockPilot dependency pins. They are not rolling `latest` requirements. Do not install or upgrade anything merely to inspect this matrix.

## Execution surface

| Command form | Release support contract |
| --- | --- |
| `node script.js`, `node script.cjs`, `node script.mjs` | Supported direct entrypoint observation for inventoried owned scripts in an attached, process-scoped launch. |
| `python script.py`, `python3 script.py` | Supported direct entrypoint observation on the POSIX scoped PATH launcher. |
| `python -m module`, `python -c code` | Unsupported automatic owned-script lifecycle qualification. |
| `python -I script.py`, `python -S script.py`, `python [options] script.py` | Unsupported launcher qualification; options can bypass site customization or prevent direct-script recognition. |
| `node -e code`, `node -p code` | Unsupported owned-file entrypoint qualification. |
| Node `--loader`, `--import`, `tsx`, `ts-node`, TypeScript/JSX/TSX | Experimental observation can exist; outside the release support promise until exact loader/version parity is proved. Inventory must retain these declarations and gaps. |
| Arbitrary shell/process/file operations | Not automatically equivalent to an owned script span or complete coverage. |

Script arguments after a supported entrypoint are preserved. Existing experimental tests do not expand this release promise. Unsupported means an evidence limit; it does not mean AgentOps blocks the underlying command.

## Read-only qualification

Run from the repository root:

```sh
node scripts/check-runtime-matrix.js --json
node scripts/check-runtime-matrix.js --help
```

The command reads local package manifests and resolves the CLI path. It starts no executable, installs nothing, makes no network call and changes no configuration. Missing packages and mismatched versions stay explicit. Native CLI version remains `resolved_version_unverified` in this metadata output because an arbitrary resolved executable is not automatically safe to invoke. Help performs no metadata reads. The reusable `readRuntimeQualification({root, env})` API has the same read-only contract.

After inspecting the resolved executable and its launcher, the bounded manual `copilot --version` check can establish executable identity. On this host the inspected path was `/opt/homebrew/lib/node_modules/@github/copilot/npm-loader.js`; the manual check disabled OTel and removed inherited Node/Python preload settings. A version check does not prove telemetry or model behavior.

## Lifecycle acceptance and platform limits

```text
abort before setup -> no collector / no child
abort during readiness -> terminate collector -> remove run artifacts
collector dies -> cancel owned child -> reap POSIX process group
stop twice -> await one shutdown -> remove only after confirmed exit
```

Focused no-model verification:

```sh
node --test agentops-cli/test/process-supervisor.test.js agentops-cli/test/scoped-collector.test.js agentops-cli/test/runtime-matrix.test.js
```

The lifecycle tests use harmless Node children and injected Collector/process dependencies. They cover pre-abort, cancellation during setup, readiness failure/throw, early Collector exit, Collector death during execution, signal escalation, cooperative cancellation, owned POSIX descendants, concurrent stop and bounded failed shutdown. A subprocess regression runs the default readiness poll and proves early exit/cancellation release its retry timer within a 2.5-second deadline; a local stalled HTTP server separately proves socket destruction on abort. Normal shutdown waits up to four seconds, then escalates and waits one second. If exit remains unconfirmed, artifacts are retained and stop rejects. Synchronous configuration validation is separately bounded at 30 seconds; JavaScript cancellation is observed after that call returns.

The tests are runnable on Windows with POSIX signal-handler/process-group assertions explicitly skipped. This macOS host cannot execute Windows proof. Windows descendant cleanup and the Python PATH wrapper are not qualified; direct child termination is the current Windows implementation. Run the focused command on an actual Windows host before claiming parity. Do not replace that run with an injected platform label.

These checks do not launch Copilot/Vally model tasks, install packages, run cloud writes or establish Azure delivery.
