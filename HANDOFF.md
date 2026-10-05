# AgentOps handoff — 3 October 2026

Prepared at 20:40 UTC. This is a continuation guide for the next developer or agent.

## TL;DR

The unsigned preview captures real Copilot CLI telemetry on macOS and a headless Windows host. Scoped Node/Python HTTP tracing also works on macOS. One synthetic native metadata event passed Azure ingestion and exact typed readback. The enterprise product is not release-ready.

Copilot CLI is the primary target. VS Code is the secondary setup and report surface. Keep setup simple, use native OpenTelemetry where supported, filter locally, and reuse the existing Azure pilot. Users must not need a separate AgentOps CLI, Node installation, Azure CLI or Docker. This preview still requires installed VS Code or VS Code Insiders and an installed native Copilot CLI.

## 1. Workspace and recovery

| Item | Current state |
| --- | --- |
| Main working directory | `<agent-workspace>/workspaces/copilot-cli-agentops-azure-inspection` |
| Working branch | `feat/enterprise-flight-recorder` |
| Working HEAD | `0b91a3671376f9bc655aa955094d995ac711254c` |
| Working tree | 139 status entries before this handoff was added; substantial modified and untracked work remains |
| Public repository | `https://github.com/c-mongan/copilot-cli-agentops-azure` |
| Remote main | `090d337d4226d7f8a3ebadc2228e9cb4c8e326b5` |
| Separate qualification worktree | `<agent-workspace>/workspaces/agentops-native-windows-ci-20261003` |
| Qualification branch | `qualification/native-windows-20261003` |
| Qualified commit | `bceeb76e09fb9dce24b36d4fd0b690823d2db48e` |
| Qualification worktree | Clean at handoff preparation |

Only the reviewed Windows qualification snapshot was committed and pushed to its separate branch. It contains a manual Windows workflow. Main was not merged or changed. The full working-tree product candidate has not been committed or published.

Preserve existing work. Do not reset, clean, force-push, switch the user's checkout, or stage all files. Before a later commit, inspect each task path and hunk. The repository is public; do not include local receipts, account data, credentials, private profiles or generated graphs in a push.

Artifacts and source clones use the SanDisk workspace. Essential tools and private test profiles remain internal. Before a large job, run `~/.local/bin/agent-storage status` and read `~/.config/agent-storage/POLICY.md`. Do not silently recreate a missing external project or use an internal fallback under storage pressure.

## 2. Architecture and data flow

```text
Companion browser controls              VS Code extension
          |                            | settings / new terminals
          +------ prepared Copilot CLI sessions ------+
          |                                          |
          |                         native Copilot OpenTelemetry
          |                                          |
          +--- selected Node / Python project runs ---+
                                                     |
                                          strict local Collector
                                         loopback 127.0.0.1:4318
                                                     |
                                     filtered receipts + local reports
                                                     |
                                    extension: optional manual publisher
                                                     |
                                      bounded, target-bound local queue
                                                     |
                                       existing Azure DCE / metadata DCR
                                                     |
                                         Log Analytics + saved Workbook
```

OpenTelemetry records spans: timed units of work such as agent, model and tool calls. Native Copilot spans do not automatically trace every function in arbitrary Python, JavaScript or TypeScript programs. Library tracing is a separate, selected-project path.

The companion has local capture and reports. **It does not offer Azure publishing in this preview.** The extension implements manual Azure metadata publishing. The current native projection sends metadata events, not the full native waterfall or library spans. A waterfall shows the order and duration of related work.

Use one capture owner per profile. The companion and extension can conflict on the same endpoint; do not connect both recorders at once. Port conflicts fail without replacing an existing listener. New prepared sessions receive telemetry settings. Existing arbitrary shells are not automatically instrumented.

| Source | Responsibility |
| --- | --- |
| `companion/src/server.js` | Local controls, request guards, Connect, report, Disconnect and Quit |
| `companion/src/copilot-launch.js` | Native binary discovery and prepared terminal launch |
| `extensions/agentops-native/src/extension.js` | VS Code commands, lifecycle and integration |
| `extensions/agentops-native/src/native-settings.js` | Supported settings, stable endpoint and owned restoration |
| `extensions/agentops-native/src/recorder.js` and `recorder-worker.js` | Capture ownership and Collector supervision |
| `extensions/agentops-native/src/script-controls.js` | Selected script setup, consent and supervised execution |
| `instrumentation/auto/` | Node/Python launch plans and library instrumentation assets |
| `collector/otelcol.local.strict.yaml` | Local telemetry allowlist and privacy filter |
| `agentops-cli/src/lib/copilot/scoped-collector.js` | Scoped ports, setup, shutdown and retained-output checks |
| `extensions/agentops-native/src/azure-auth.js`, `azure-controls.js`, `azure-delivery.js` | Microsoft sign-in adapter, user approval and native metadata delivery |
| `agentops-cli/src/lib/copilot/delivery-limits.js` | Shared publishing byte reservations and target/policy binding |
| `infra/bicep/enterprise-*.bicep` and `workbooks/agentops-enterprise-workbook.json` | Prepared enterprise infrastructure and cloud report contracts |

## 3. Verified evidence and limits

| Check | Evidence | Limit |
| --- | --- | --- |
| macOS native CLI | Four real native spans, one trace, agent/chat/tool operations and fixed tool execution | Local synthetic model; no paid provider or model-quality proof |
| macOS companion GUI | Actual packaged v3 Connect, report, Disconnect and Quit; listeners closed, process exited 0, owner lock released | Historical v3 GUI proof; current v5 has later reviewed portability changes |
| VS Code host | Actual isolated extension host received filtered synthetic telemetry; real terminals received eight variables and none after Disconnect | Live Copilot Chat emission and rendered setup dialogs remain unproved |
| Node/Python script host | Actual macOS VS Code host ran Node/Python HTTP fixtures and stopped a long-running child; three HTTP spans | File/interpreter/consent selections were fixtures; not rendered wizard proof |
| Windows native CLI | Real packaged batch launcher, Collector, four native spans, one trace, fixed PowerShell tool, canary filtering and complete owner/lease cleanup | Headless Windows Server 2025; not desktop install, normal-user ACL or GUI proof |
| Azure native adapter | One synthetic metadata event, 473 wire bytes, HTTP 204, one acknowledgement, exact readback of all 63 maintained fields | Cached Azure CLI token injected as a test credential; not actual Microsoft-provider sign-in or live captured cloud export |
| Product usefulness | Fixture evaluation and provenance checks exist | No qualified held-out model trial or independent human diagnostic timing |

Passing Windows run: [37149760874](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/37149760874), exact commit `bceeb76e09fb9dce24b36d4fd0b690823d2db48e`. GitHub status and commit were read again for this handoff.

Pinned Windows inputs: Copilot CLI `1.0.91`, VS Code `1.140.0` with Node `24.21.0`, and Collector `0.151.0`. The runner used Node `20.20.2`. Published summary and local summary matched exactly. Results: 97 tests passed, two host-specific checks skipped, zero failures or cancellations. Native runtime qualification also passed. The canary was seen before filtering and absent after filtering. Launcher exit was 0; owner process and capture lease were gone.

The saved full CLI suite records 1,033 passes, one skip and zero failures. It predates the last Windows portability repairs. Relevant later checks were run after those repairs: 65 native checks and 34 focused checks passed locally, followed by the passing actual Windows run. Do not describe the older full suite as a fresh run against every final file.

Three failed Windows runs remain useful regression evidence:

1. `37148214250`: path-separator assertion, unsupported directory `fsync`, CMD quoting and a CI step that masked an earlier failure.
2. `37149018604`: launcher and Collector worked; CRLF line endings caused native scope validation to fail and prevented private metrics port injection.
3. `37149602566`: CRLF regression passed; a cancellation test read Node exit metadata before the Windows exit event arrived.

Repairs kept the required tests. CI now checks each command's exit code. CRLF is normalized before exact scope checks. The cancellation test requires physical PID disappearance and a bounded exit notification. Windows skips the unsupported parent-directory flush; file flush, atomic rename, locking, ceilings and target binding remain. Windows therefore lacks the extra POSIX directory-flush power-loss guarantee.

## 4. Deployment and cost boundary

The existing development/test pilot is in North Europe:

- Subscription: `<subscription-id>`.
- Resource group: `rg-copilot-agentops-synthetic-pilot-20260930`.
- Existing workspace, DCE and 11-stream metadata DCR are reused.
- Saved Workbook: `0c9ff309-52d7-5203-a194-ba64fae76a13`.
- Budget: `budget-agentops-diagnostic-pilot`, EUR 10 per month, no notification recipients. **This budget is not a hard cap.**

The prior enterprise deployment added the Workbook and budget. Its 97 synthetic rows across 11 streams passed typed schema and multiplicity comparison. The later native adapter test added one separate synthetic row. It did not change resources, roles, default accounts or policy.

For the one-row native proof, Azure `_BilledSize` was 237 bytes, distinct from the 473-byte wire body. Missing output tokens remained null. One upload was sufficient; no second upload was used to address query latency. The attempted-publishing allowance was 16,384 bytes.

Actual Microsoft-provider authentication, tenant consent, least-privilege team access and observer isolation remain unqualified. The cached-token test used broad existing access. Spending limit was On at execution; current remaining credit and prices were not refreshed for this handoff. Refresh target, effective access and costs before a new cloud write or production plan.

Do not run `azd provision` as a shortcut. The baseline `main.bicep` can create/rebind workspace resources, and `azure.yaml` has a postprovision import hook. Use the reviewed additive enterprise route and its exact target checks. No new compute service, hosted judge, AKS cluster or Grafana service is needed for this preview.

See [deployment verification](docs/research/2026-10-02-enterprise-deployment-verification.md), [lean cost/deployment plan](docs/plans/2026-10-02-lean-enterprise-deployment.md) and [native Azure proof](docs/research/2026-10-03-native-azure-proof-preflight.md).

## 5. Packages and proof locations

External artifact root: `<agent-workspace>/artifacts`.

| Package | Path below artifact root | SHA256 |
| --- | --- | --- |
| macOS ZIP | `agentops-native-companion-macos-v5/AgentOps-Native-Companion-mac-preview.zip` | `2d82cfec29759a833dd408376ff4938ce86114781b43c6a3135f62c8576e0eb2` |
| Windows ZIP | `agentops-native-companion-windows-v5/AgentOps-Native-Companion-windows-preview.zip` | `b1782f1a7f9019d7f87737c02d9983e9228d92f019e7be001e3fb1405b6b8e55` |
| VSIX | `agentops-native-vsix-qualified-v4/agentops-local.agentops-native-0.1.0.vsix` | `f2b3dc5510abb151d270d57153760ca8dd7835ebba2a0b6b7a68a46f7d792adb` |

All three hashes were checked again for this handoff. Both companions are unsigned previews. Both ZIPs passed extraction checks; the Mac launcher retained executable permissions. Prior package versions were preserved.

The package manifest is `agentops-native-package-manifest-v5/artifact-manifest.json`. At build time, 37 Mac, 37 Windows and 46 VSIX copied-source files matched. At handoff, both companions still match all listed sources. The VSIX differs only in its bundled README: the repository README was updated after packaging. Its runtime files still match. Rebuild the VSIX before a release if it must include the latest README.

Important evidence paths below artifact root:

- `native-build-20261003/windows-ci-final-summary/windows-qualification.json` — bounded Windows result.
- `native-build-20261003/windows-ci-final-full.log` — complete passing Windows log.
- `native-build-20261003/windows-ci-qualified-source-manifest.json` — 69 qualification code/asset/workflow paths matched the working candidate.
- `native-build-20261003/azure-proof-preflight/actual-upload-receipt.json` — separate HTTP acknowledgement.
- `native-build-20261003/azure-proof-preflight/typed-readback-poll-1.json` — separate typed cloud observation.
- `native-build-20261003/companion-v3-native-proof.json`, `companion-v3-ui-proof.json`, `companion-v3-report.png` — historical Mac native/GUI proof.
- `native-build-20261003/cli-suite-final.log` — saved full CLI suite.
- `agentops-native-final-host-proof-20261003/` — real isolated VS Code API/terminal proof.

Script setup evidence is under `<agent-workspace>/scratch/agentops-script-setup-20261003/`. Official source clones are under the sibling workspace `copilot-native-docs-20261003/`, including SDK and VS Code sources. External artifacts are not bundled into this Markdown file. Preserve the drive and verify paths before reuse.

## 6. Security and operational limits

- Keep content and identity capture off by default. Filter before durable storage or cloud upload. A known canary test is not a universal secret detector.
- The Collector drops unknown metrics and some linked/exemplar-bearing telemetry. Coverage loss must remain visible.
- Capture stops at a sampled 12 MiB receipt-plus-log threshold. Bursts can exceed it. New capture is blocked at 32 MiB retained output or an unsafe scan. This is not a hard disk quota; files are not deleted automatically.
- Azure publishing is manual and off by default. A successful socket, upload acknowledgement and typed cloud readback are separate states.
- Restore only settings still owned by this setup. Preserve later user/admin edits. Do not install OS policy, root hooks, broad process injection or automatic startup as routine cleanup.
- No public product release, signing, notarization, unattended daemon or normal-user Windows installation was proved.
- Stop publishing to contain delivery. Retain queue and acknowledgement evidence. Do not purge cloud rows or delete retained files as routine recovery.

## 7. Open work, in recommended order

1. **Qualify a full native connect in a compatible VS Code.** Computer control now works (see §13). The no-connect commands and the unsupported-host path pass in the GUI. Full connect is still unproven: portable stable VS Code 1.140.0 rejects Copilot Chat 0.68.0 because its `authIssuers` API proposal is not allowed. Use a matching VS Code and Copilot Chat pair, such as Insiders with an isolated profile. Acceptance: actual file/interpreter/consent selection, received spans, cancellation and rendered report.
2. **Prove Azure sign-in without Azure CLI.** Use the extension's actual VS Code Microsoft provider, the approved pilot target and a bounded synthetic fixture. Acceptance: account/tenant selection, consent, token renewal as applicable, upload acknowledgement and exact typed readback. Do not substitute another cached CLI token for this gate.
3. **Qualify Windows desktop use with a normal user.** Acceptance: install/extract, double-click launch, discovery of installed native Copilot, rendered controls/report, restart, Disconnect, Quit, retained-file ACLs, uninstall and an administrator-policy case. Headless CI is not a replacement.
4. **Qualify live VS Code Chat after reload.** Settings success alone is insufficient. Installed Chat can retain startup exporter configuration. Keep reload/capture-unverified status until an actual native Chat receipt exists.
5. **Complete cloud trace coverage.** Design and verify a strict projection for full native waterfalls and selected library spans against maintained schemas. Current native Azure delivery covers metadata events only. Keep unknown/missing values visible.
6. **Measure usefulness and overhead.** Run held-out tasks against a baseline. Record actual model/runtime provenance, diagnosis accuracy, time to diagnosis, missing coverage, process overhead and accepted bytes. Fixture grading is not human benefit or live model quality. Select any paid model budget before new spending.
7. **Prepare release and enterprise operation.** Select organization-owned target, operators and principal groups; prove least-privilege allowed/denied access. Add signing/notarization and installation/update/uninstall proof. Review optional startup/device policy separately. Confirm costs before deployment; do not buy infrastructure or identity licenses to satisfy a generic checklist.

Do not mark these gates complete from implementation, a ready Collector, mock consent or a synthetic model alone.

## 8. Commands for a safe continuation

Run from the main working directory. These commands perform local tests; they do not deploy Azure resources or call a paid model:

```sh
git status --short
git branch --show-current
git rev-parse HEAD
node scripts/run-native-tests.js
node --test scripts/test/qualify-native-cli.test.js scripts/test/qualify-native-windows.test.js agentops-cli/test/delivery-limits.test.js agentops-cli/test/scoped-collector.test.js
```

Reuse valid results for unchanged code. Do not repeat the full suite only to close a task. Inspect scripts before running broader commands. The Windows runtime harness downloads pinned binaries and must run on a disposable Windows host; it rejects a Mac host. Any further CI dispatch or cloud action must use the current session authority and reviewed exact target.

Ponytail, local code-only Graphify and scoped Open Code Review were used during the build. Their reviews were bounded; they do not certify the whole dirty repository. For new code exploration, read `~/.graphify/AGENT_GUIDE.md`, use a fresh scoped graph where useful, then verify exact source. Do not upload source or perform remote semantic extraction by default.

## 9. Read first

1. [Current build status](docs/plans/2026-10-03-cli-first-build-status.md).
2. [Build verification](docs/research/2026-10-03-cli-first-build-verification.md).
3. [Companion use and recovery](docs/native-companion.md).
4. [Native settings and Azure controls](docs/native-client-settings.md).
5. [Windows qualification](docs/native-windows-qualification.md) and [independent review](docs/research/2026-10-03-windows-qualification-review.md).
6. [Script setup proof](docs/research/2026-10-03-script-setup-proof.md).
7. [SDK source findings](docs/research/2026-10-03-sdk-native-docs.md), [VS Code source findings](docs/research/2026-10-03-vscode-native-deep.md), and [auto-instrumentation/Azure findings](docs/research/2026-10-03-auto-instrument-azure-docs.md).

## 10. Mac v5 computer-use update — 2026-10-03

The Mac v5 preview has now passed the visible Connect, local report, Disconnect and Quit checks. See [the computer-use proof](docs/research/2026-10-03-mac-v5-computer-use-proof.md). The rendered report showed 5 native spans, 2 sessions, 24 input tokens and 10 output tokens. A separate real Copilot CLI run with a synthetic local model proved four linked spans, tool execution and privacy filtering through the running companion Collector. These are separate proof counts.

After Quit, the app owner process was gone, the capture lease was removed, and ports 4318 and 58235 were closed. No paid model or new Azure write was used in this trial.

Native computer control recovered enough for the Mac browser controls. Terminal control was explicitly denied by the tool. VS Code inspection worked, but the keyboard shortcut and visible View > Command Palette action did not open the palette. No temporary profile or extension installation was completed through this UI. The script wizard, Microsoft sign-in and Windows desktop gates remain open.

The next engineering action is to restore reliable VS Code UI input, then test the script wizard in an isolated profile. The next small user action is to open VS Code and check whether **View > Command Palette** opens normally. Do not repeat the completed Mac Connect/report/shutdown test unless its code changes.

## 11. Capture-stage status and read-only Azure check — 2026-10-04

**Built.** `extensions/agentops-native/src/capture-stages.js` reports five separate states: Collector, native receipt, script receipt, upload and cloud readback. The companion `/status` JSON and page, and the extension status message, use it. The VSIX and companion packagers include it. Cloud readback stays `unverified` until typed readback exists. This closes build-status item 2 locally only.

**Review.** OCR delegate rule selection covered the four changed source files. The manual review found one defect: `/status` polls every 5 seconds and re-parsed a receipt of up to 16 MiB each time. The companion now caches by path, size and mtime and re-reads at most every 15 seconds. Tests: native 69/69, supporting 34/34, packaging 2/2.

**Azure (read-only, Visual Studio Enterprise subscription).** All AgentOps resource groups exist in northeurope. Log Analytics rows over the last 30 days:

| Workspace | Tables with rows | Last row |
|---|---|---|
| law-copilot-agentops-eval-eval930 | Events 1662, Spans 1707, RunSummary 9, CollectorHealth 8, Eval 8, ToolCalls 8, Insights 5, GithubOutcomes 2, Recommendations 1 | Events 2026-10-03 18:30Z; others 2026-10-02 |
| law-copilot-agentops-eval-dev | Spans 117, Content 62 | 2026-09-29 |

These rows are pre-existing synthetic or pilot data. They do not prove the VS Code Microsoft provider path.

**Wizard gate (still open).** A fresh VSIX with the stage module was installed into an isolated Insiders profile (`/private/tmp/ao-gui-s`) and launched. The computer-use tool saw the isolated window once. It then switched to the user's normal Insiders process, because both processes share the bundle ID `com.microsoft.VSCodeInsiders`. It cannot target by PID. The isolated window was closed; the normal window was not touched. To unblock, quit the normal Insiders window during the test, or use a stable VS Code build for the isolated profile.

## 12. Typed Azure cloud readback — 2026-10-04

**Built, not gate-proven.** `extensions/agentops-native/src/azure-readback.js` checks that published native events reached Log Analytics. Run it with the command **AgentOps: Verify Azure cloud readback**.

- **Setup.** Add `readbackWorkspaceId` to `agentopsNative.azureDestination`. This is the workspace customer ID (a GUID). Destinations without it keep their earlier consent hash.
- **Access.** The command signs in with a separate read scope, `https://api.loganalytics.io/.default`, through the VS Code Microsoft provider. The principal needs Log Analytics Reader on the workspace.
- **Query.** It sends a fixed KQL query over `AgentOpsEvents_CL` for event IDs this window admitted. The lookback is 7 days. It checks the latest 500 IDs and reports `sampled` when there are more. It checks EventName, Surface, SchemaVersion, PrivacyMode and ContentCaptureMode against strict-mode expectations.
- **States.** The cloud readback stage shows one of verified, partial, pending (nothing found yet, so ingestion may lag), missing, mismatch, denied, failed or unverified. Event IDs are never displayed. Readback does not prove capture coverage or task outcome.
- **Review.** OCR delegate rule selection covered the six changed source files. The manual review found one defect: sampling was under-reported after the controls trimmed the IDs to 500. It is fixed and tested.
- **Tests.** Native 77/77 (including packaging) and supporting 34/34. The VSIX includes the module and the command.
- **Live smoke test (read-only, Azure CLI token, not the provider gate).** The real module ran against eval930. Azure accepted the query and returned `missing` for a placeholder native ID. That result is expected, because no `native-otel` rows exist yet.

**Remaining proof.** Sign in with the Microsoft provider, publish a bounded synthetic native receipt, wait for ingestion, then run the verify command. It should show `verified`.


## 13. Computer-use GUI test — 2026-10-04

Tested in portable stable VS Code 1.140.0 with an isolated profile (`--user-data-dir` and `--extensions-dir` under `/private/tmp`). The user's normal profile was not touched. No Azure writes were made.

| Command or path | Result |
|---|---|
| Activation, status bar and 10 commands | Pass |
| Connect consent modal | Pass |
| Collector download and checksum | Pass (earlier run) |
| Connect failure rollback | Pass: status shows Error and owned settings were restored |
| Connect on an unsupported host (new preflight) | Pass: status shows Unsupported, the error names the missing settings, and nothing is downloaded |
| Start Copilot terminal on an unsupported host | Pass: consent, then Unsupported; no terminal opens |
| Trace selected project script while off | Pass: asks the user to connect first |
| Capture status while off | Pass: all five stages report honest off/none/unverified values |
| Verify Azure cloud readback with no destination | Pass: error says to set the Azure destination |
| Open local report | Pass: renders, with unknown coverage and token values shown as Unknown |

**Fix from this test.** Before this fix, a host without the Copilot Chat telemetry settings downloaded the Collector and then failed with a generic error. `connect()` now checks for unsupported native settings before `Starting`. It releases the profile lease, sets Unsupported and shows a specific error. A new unit test covers this. Native tests pass 78/78; supporting tests pass 34/34. An OCR delegate review of the change found no defects.

**Environment limit.** Copilot Chat 0.68.0 needs the `authIssuers` API proposal. Stable 1.140.0's product.json does not allow it, and `--enable-proposed-api` does not override this. Patching the app is blocked by macOS App Management, so I did not do it. Full connect, live Chat spans and Azure publish/readback remain unproven.

### 13.1 Insiders 1.141 follow-up — 2026-10-05

Ran the extension as a development extension in an isolated copy of Insiders. The copy has bundle ID `com.microsoft.VSCodeInsiders.aotest`, is signed ad hoc, and uses its own user-data and extensions dirs on the SanDisk. The rebundle was needed because computer use targets apps by bundle ID, and the plain Insiders ID targets the user's main window. The user's main Insiders profile was not changed.

| Command or path | Result |
|---|---|
| Activation in Insiders with Copilot built in | Pass: no `authIssuers` rejection |
| Status bar item and stage message while off | Pass |
| Command palette lists all AgentOps commands | Pass |
| Connect (consent sheet) | Pass: 6 `github.copilot.chat.otel.*` keys written, Collector started, status "Chat reload required" |
| Reload after Connect | Pass (after fixes below): keys kept, Collector restarted, status "Collector ready; Chat unverified" |
| Disconnect | Pass: 0 otel keys left in `settings.json`, no `otelcol` process, status "Collector stopped" |
| Connect again without reload, then Disconnect | Pass: endpoint reused, no false environment block, clean disconnect |

**Root causes found and fixed by GUI testing.**
1. Copilot Chat sets `COPILOT_OTEL_FILE_EXPORTER_PATH=os.devNull` in the extension host when OTel is not explicitly enabled. The environment check treated it as an override. `native-settings.js` now skips this sentinel.
2. After the reload, Copilot writes its normalized endpoint (`http://127.0.0.1:PORT/`, trailing slash) into `OTEL_EXPORTER_OTLP_ENDPOINT`. A strict string comparison blocked the reconnect and rolled the settings back. Endpoint keys are now compared as normalized URLs (`sameEnvironmentValue`).
3. The fresh-connect preflight uses a placeholder endpoint, so it no longer judges endpoint values. `connectNativeSettings` checks them against the real Collector endpoint.

Regression tests cover all three (native 84/84, supporting 34/34). Earlier memory and screen-recording blocker: cleared by the user.

### 13.2 Signed-in Chat end to end — 2026-10-05

The test profile was signed in to GitHub through the loopback OAuth flow in the system browser. Chat then worked, but no spans reached the Collector.

**Root cause.** In Insiders, the local Agent Host process runs Chat. It reads `chat.agentHost.otel.*` (application scope), not `github.copilot.chat.otel.*`, and only when it spawns. Fixes:
1. Connect now writes the host keys (`enabled`, `exporterType`, `otlpEndpoint`, `captureContent:false`). It no longer writes the host `otlpProtocol`, because that is not a registered setting. Host `captureIdentity` is optional, because Insiders registers it hidden (`included:false`). If it is present, it must be false.
2. Connect and Disconnect run `workbench.action.chat.restartLocalAgentHost` when the host keys are owned.

Insiders may also show a native "A setting has changed that requires a restart" sheet. Choosing Restart relaunches the app. AgentOps then auto-reconnects on the same endpoint, but in a new Collector run directory. Each window load starts a new `receipts/run-*`, so read the newest run.

| Step | Result |
|---|---|
| Connect, then accept the restart | Pass: 6 Copilot keys and 4 Agent Host keys, auto-reconnect |
| Chat "Reply with just: pong" | Pass: "pong" (GPT-5.6 Sol) |
| `native-receipt.jsonl` | Pass: spans from `vscode-agent-host` (5) and `github-copilot` (110, including `chat` and `invoke_agent`); names redacted by the strict config |
| Capture status | Pass: "Data received; Chat unverified", "Telemetry received: 6 native spans" (only supported GenAI/tool spans are counted) |

Tests: native 87/87, supporting 34/34. OCR delegate review was clean. Still unproven: Azure publish and cloud readback, which need a configured destination and were not attempted because this test did not allow Azure writes.

**Computer-use notes.** `type_text` does not reach the command palette or Monaco. Use `set_value` on the palette field and press Return. For Chat, use `pbcopy`, click the input, then paste.

## 14. Azure skills, tabbed Workbook and end to end — 2026-10-05

| Item | Result |
|---|---|
| Azure skills | 6 vendored under `.github/skills/`, with a README covering guardrails and provenance, and the MIT licence |
| Workbook UX | 7 tabs, KPI tiles and a time chart; 14 panels (`docs/enterprise-workbook.md`) |
| Deploy | Deployments tabs, ux2 and ux3 succeeded; what-if changed only the Workbook; readback matched |
| E2E | 3 synthetic spans returned HTTP 204; readback 3/3; all 14 queries ran live over 7 days |
| Portal | The tile text and chart were fixed and verified in the portal. The other tabs have not been visually critiqued yet, because the browser was in use. |

**Gotcha.** Insert `{TimeRange:start}`, `{TimeRange:end}` and `{TimeRange:grain}` into KQL unwrapped.

## 15. Copilot code review enabled — 2026-10-05

- Ruleset `Copilot code review` (id 24505587) is active on the default branch of `c-mongan/copilot-cli-agentops-azure`. It contains the single rule `copilot_code_review` with `review_on_push: true` and drafts excluded. It requests a review but does not block merging.
- Added `.github/copilot-instructions.md`. It tells the reviewer to prioritise privacy (metadata only), keeping secrets and receipts out of the repo, Azure safety, and Workbook KQL conventions.
- Local CI run, all passing: CLI 1035/1035, native 87/87, static check (1250 files), IaC contract, Workbook contract, JSON assets, coverage, security audit 13/13, strict poison collector smoke.
- Copilot review triggers only on a PR. This branch is still uncommitted and needs the owner's approval to commit, push and open the PR.

## 16. PR #167, CI and Copilot review rounds — 2026-10-05

- PR #167 (`feat/enterprise-flight-recorder`) has these commits: a009b68 (feature), b789153 (CI fixes), a9d4512 (first-round review fixes), 780d089 (re-review fixes), and this handoff commit.
- CI passes on 780d089: offline ubuntu, offline windows, and collector binary install.
- First Copilot round raised 7 findings, all fixed and resolved:
  - recipe exit codes and OIDC/AzureCLI inline settings;
  - SDK `safeIdentifier` and strict-collector OTTL guards, including model metadata;
  - fail-closed `repoRelative()` packaging;
  - Windows test fixes;
  - doc path and run-ID redaction.
- Second Copilot round raised 8 findings. Three were already fixed. The other five were fixed and resolved:
  - The CI deploy examples are now manual only, approval-gated, and run preview/what-if first. None of them use `azd up`.
  - The `.refs/` gitleaks allowlist is narrowed to `^\.refs/`, and `.refs/` is gitignored.
  - Recorder-worker fatal handlers exit 1. A regression test covers this.
- Privacy: personal paths and subscription/tenant IDs are replaced with placeholders in the tree. They remain in the pushed history of a009b68 and b789153. **Squash-merge** the PR, or rewrite history only with the owner's approval.
- Merging is not blocked. The owner decides when to merge.
