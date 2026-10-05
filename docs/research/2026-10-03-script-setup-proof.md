# Selected project script setup proof

On 2026-10-03, the current script controls ran real Node and Python HTTP fixture scripts in an isolated VS Code extension host. The current capture controller started its real Collector worker. The local receipt contained the safe HTTP library classification. No model request or Azure operation ran.

```text
Real workspace + activation context
            |
Fixture file/interpreter selection + consent
            |
Current script wizard -> selected real process
            |
Native library instrumentation -> real strict Collector
            |
Filtered local receipt -> numeric library report
```

## Scope and results

| Check | Result |
|---|---|
| VS Code API and activation context | Real VS Code Insiders 1.141.0; real Memento, storage URI and environment collection |
| Host runtime | Electron 43.7.3, Node 24.21.0 |
| Selected Node runtime | Actual extension-host executable in `ELECTRON_RUN_AS_NODE` mode; real dependency probe and real process |
| Python runtime | Selected disposable project virtual environment, Python 3.14.6 |
| Dependency setup | Previously installed, pinned project dependencies; no installation in this test |
| CJS script | Exit code 0; one safe HTTP library span received; process no longer alive |
| Python Requests script | Exit code 0; one safe HTTP library span received; process no longer alive |
| Long-running CJS script | Third HTTP span received; supervised `SIGTERM`; selected process no longer alive |
| Privacy | Synthetic request-URL secret canary absent from the filtered receipt |
| Final report | 3 library spans, 3 HTTP spans, 0 database spans, 0 native Copilot spans |
| Outcome and coverage | Unknown; no task outcome inferred from successful script exit |
| Azure | Unverified; no Azure operation attempted |
| User interaction | File selection, interpreter input and consent were fixtures; rendered dialogs were not exercised |

The actual `createScriptControls` implementation ran with the real workspace API and actual parent `controller.captureContext`. Only file selection, interpreter input, module choice and confirmation responses were controlled by the harness. The dependency probe, bootstrap, process supervision, Collector, filtering and report were real. A wrapper recorded the selected child PID but delegated execution to `child_process.spawn`.

The current capture controller used the real configuration API. The harness checked that the effective Copilot endpoint matched the active Collector and content capture was disabled. Disconnect restored the six inspected Chat settings to their previous values in this isolated profile. This does not qualify actual Copilot Chat emission.

The first stop test waited four seconds before termination. Node's default batch export interval had not elapsed, so the third span was lost. The test retained that result. A repeated stop test waited for confirmed receipt before termination and passed. This supports the command's warning that termination can lose buffered spans. It does not promise a successful flush on cancellation.

A separate harness retry initially omitted the saved endpoint in its test recorder wrapper. The controller correctly rejected the random replacement endpoint. The wrapper was corrected to forward the supplied recorder options. Product code was not changed for either harness issue.

## Evidence and repeat setup

The private evidence directory is:

`<agent-workspace>/scratch/agentops-script-setup-20261003/`

- `proof.json`: final successful checks and numeric report.
- `proof-buffer-loss.json`: retained first stop-test result.
- `proof-harness-endpoint.json`: retained harness endpoint forwarding failure.
- `harness/runner.js`: exact test runner.
- `harness/extension.js`: minimal extension that exposes its real activation context.
- `workspace.code-workspace`: two disposable project folders.
- `profile/`: isolated test profile. The normal VS Code profile was not changed.

The disposable package environments remain at:

`<agent-workspace>/workspaces/agentops-library-auto-proof-20261003/`

The current repository source was tested. This check did not validate a final VSIX package. The extension host loaded the existing bundled Copilot package as a development extension to supply its configuration schema. It did not use Copilot to request a model.

The launch used the existing VS Code Insiders application with `--user-data-dir`, `--extensions-dir`, `--extensionDevelopmentPath` and `--extensionTestsPath`, all directed to the disposable scope. Workspace trust was disabled only for this controlled fixture workspace. Update and extension update checks were disabled in the isolated profile. The normal profile and shell settings were not touched.

## Remaining GUI check

A human or computer-use agent must still open the installed package, select the command, inspect the rendered file picker and interpreter prompt, confirm consent, and open the resulting numeric report. The extension-host test is not rendered GUI proof. ESM emission has separate real library and Collector tests; it was not selected through this host wizard test. TypeScript loaders, Windows and Linux are not qualified here.

A separate `gui-harness/` is ready in the evidence directory. It registers four real commands: `Script proof: Connect local capture`, `Script proof: Trace selected project script`, `Script proof: Open numeric report`, and `Script proof: Disconnect local capture`. Unlike the automated runner, it does not mock dialogs. It creates synthetic loopback-only `gui-fixture.cjs` and `gui-fixture.py` files in the disposable project folders. This harness is prepared but was not launched or rendered in this check. Launch it with a **new isolated profile** and the same disposable workspace and bundled Copilot extension development path. It is a source-flow harness, not final package proof.

## Prepared real-dialog window

A separate real-dialog window was launched for parent computer-use checks. Its exact title is `AgentOps Script GUI Proof`. It uses the new internal disposable profile `/private/tmp/agentops-script-gui-20261003-b11191ae/profile`, empty isolated extensions directory, the `gui-harness/` development extension and the existing bundled Copilot configuration extension. The launch metadata is in `gui-launch.json`. This window does not use the normal profile.

1. Run `Script proof: Connect local capture` and confirm the real Connect dialog.
2. Run `Script proof: Trace selected project script`, choose the `node` workspace folder, then select `<agent-workspace>/workspaces/agentops-library-auto-proof-20261003/node/gui-fixture.cjs`.
3. Keep the default selected Node executable. Confirm `Run selected script` in the real consent dialog.
4. Run `Script proof: Open numeric report`.
5. Run `Script proof: Disconnect local capture`. This saves `gui-proof.json` with local receipt, canary absence and settings restoration checks.

The harness creates the fixture files only when it activates. It runs a synthetic loopback HTTP server and reuses the existing cached Collector. It does not request a model or start Azure delivery. `gui-proof.json` is absent until the real flow completes. The prepared window by itself is not rendered interaction proof. Parent computer-use evidence must record the actual dialog and report interactions separately.

## Computer-use attempt and owned cleanup

The parent computer-use attempt could not select the isolated application process. `getApp` selected the normal Code window. The later native inventory returned `native pipe startup failed`. The parent did not perform Connect or script wizard actions in the proof window. No rendered wizard or report proof was obtained.

The owned GUI proof process was stopped with `SIGTERM` after its command line was checked for the exact profile `/private/tmp/agentops-script-gui-20261003-b11191ae/profile`. No broad application kill command was used. Its surviving helper processes, if any, were checked against the same exact profile before cleanup. The normal Code process was preserved.

Readback found no remaining owned GUI process, no `native-capture.lock`, no activated `local-proof.script-setup-gui` storage directory, no `gui-proof.json`, and no listener on port 4318. The harness had not started native capture. `gui-cleanup-proof.json` records the exact cleanup results. Source, profile, launch metadata and dependency fixtures remain available for retry. The isolated window is now closed. The automated real extension-host proof remains valid; rendered interaction remains blocked by the computer-control surface.
