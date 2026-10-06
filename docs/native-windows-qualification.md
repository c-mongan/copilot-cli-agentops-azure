# Bounded Windows native qualification

Status: local preparation verified on Mac. The actual Windows job has not run.

Use the existing public repository's registered `ci.yml` workflow on a reviewed qualification branch. Replace that branch's workflow with `scripts/fixtures/native-windows-ci.yml`. Do not merge this snapshot into main or publish the whole dirty worktree. The template has one manual Windows job, a 15 minute timeout, read-only repository permissions, no Azure credentials, and no paid model calls. Checkout does not retain its credential. It uploads only a bounded summary JSON, at most 1 MiB, with one day retention.

```text
Reviewed source snapshot -> Windows runner Node 20 fixture checks
                        -> Verified native CLI + verified VS Code archive
                        -> Portable batch launcher + private temporary profile
                        -> Verified local Collector + offline synthetic provider
                        -> Real native spans/tool + filter check
                        -> Quit + process/lease cleanup -> Small proof JSON
```

## Pinned inputs

- Copilot native Windows x64 package: `@github/copilot-win32-x64@1.0.91`. Its tarball uses a fixed SHA512 integrity value obtained from the [official npm version metadata](https://registry.npmjs.org/@github%2fcopilot-win32-x64/1.0.91). The job extracts only `package/copilot.exe`. It does not install npm packages or depend on a global Node runtime for Copilot.
- VS Code Windows x64 archive: `1.140.0`, official archive SHA256 `52f47072473375767d63ea5be9ffb96a3092124223fe5ce036834a299715014e`. This input is separate from the installed Mac Insiders version. The fixed URL and digest were obtained from the [official update metadata](https://update.code.visualstudio.com/api/update/win32-x64-archive/stable/latest). The job checks the fixed digest before extraction.
- Collector: `0.151.0`. The existing release helper verifies the official release checksum before extraction. A changed default version fails qualification until the pin is reviewed.

The Windows fixture exposes only the `powershell` tool and approves only `shell(Write-Output)`. It executes the fixed `Write-Output agentops-native-fixture` marker. [GitHub tool reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).

## Proof gates

1. Node 20 runs native extension/companion fixture checks and the focused qualification checks. The Mac Bash launch test does not run on Windows; Windows path and binary checks still run.
2. The actual generated Windows batch launcher finds the verified VS Code runtime under the disposable `LOCALAPPDATA` tree. `--no-browser`, `--port`, and `--storage` are test flags. The normal double-click flow still opens the browser.
3. The headless control page returns its per-process token. Connect starts the owned strict Collector at loopback port 4318. Port conflicts fail without replacing a listener.
4. The pinned native Copilot runtime uses only a local synthetic model, a private `COPILOT_HOME`, and the fixed tool approval. Provider, GitHub, exporter credentials, and `NODE_OPTIONS` are excluded from its environment. Windows OS bootstrap variables are retained.
5. The fixture checks actual agent/model spans, one trace, physical parentage, actual fixed tool execution, and a known privacy canary before/after the filter. Capture and tool proof are separate fields. Console output receipt is a separate field and cannot substitute for spans or tool execution.
6. Quit must remove the lease, end the owned server process, and end the portable launcher with code 0. Failure cleanup targets only the subprocess tree started by this harness.

The summary must show `passed:true`, `native.captureQualified:true`, `native.toolQualified:true`, `launcherQualified:true`, `ownerProcessGone:true`, and `leaseRemoved:true`. Any missing gate fails the job. A failed job can still provide useful partial evidence; do not call the product Windows-qualified from partial proof.

A headless runner does **not** prove rendered desktop UI, Windows Terminal interaction, Winget discovery, normal user ACLs, managed device policy, normal account use, Azure authentication/upload, live model quality, or diagnostic value. Those remain separate host and service gates.

## Minimal source closure

Run `sourceClosure()` from `scripts/qualify-native-windows.js` to obtain the exact source paths. It contains the companion, extension fixture surface, package/qualification scripts, strict Collector assets, and the static local library dependency closure. It excludes research reports, infra, generated graphs, local receipts, and user data. Copy the workflow template separately to `.github/workflows/ci.yml` in the isolated branch.

The parent owns review, snapshot copying, commits, any public push, dispatch, and readback. This local preparation did not perform those actions. Local checks pass on Mac. Actual Windows runtime qualification remains a separate gate.

## First Windows run and repair

Run `37148214250` verified the pinned downloads and started the real VS Code Node runtime (`v24.21.0`). The portable control service did not become ready. It also exposed a separator-specific recorder test and Windows directory-fsync failures. The first multi-command PowerShell test step masked its initial nonzero exit; the repaired workflow checks `$LASTEXITCODE` after every Node command. The strict test assertions remain.

The launcher repair follows Windows `cmd /s /c` quoting rules: an outer quote pair protects the quoted launcher and storage arguments, and `windowsVerbatimArguments:true` prevents libuv from inserting incompatible escapes. This is a credible cause from the launch path; another actual Windows run must prove the result. The summary now has a fixed substage, a numeric launcher exit code, an allowlisted spawn error code, and a fixed output class. It never publishes raw launcher output. The directory-fsync regression is included in the qualification source closure and guarded focused test step.


## Second Windows run and CRLF repair

Run `37149018604` at `a25305634d6b615cbc3a85ca3b1ca6b272b154dc` passed the fixture checks, pinned downloads, actual portable launcher, control-page readiness, and Collector Connect. Native runtime qualification then threw before it returned a proof result. The job failed; native capture and tool execution were not proved.

A local reproduction identified Windows checkout line endings as the cause. The strict Collector template had CRLF line endings. The scoped config function did not insert its loopback telemetry listener, and the external scope validator rejected its exact LF endpoint comparison. Both functions now normalize CRLF to LF before their existing template checks. The receiver, privacy processor, receipt exporter, and wrong-port denial checks remain. A regression uses the real strict template to check every scoped listener and the telemetry listener.

The harness now reports the `native-qualification` substage and a fixed exception class. It does not publish exception text, private paths, credentials, or raw process output. The guarded focused workflow step also runs the scoped Collector lifecycle and CRLF tests. The repaired source needs a new actual Windows run; local tests do not prove that gate.


## Third Windows run and cancellation observation

Run `37149602566` at `3261bce33f49e91a5aafc274d2e615bbaa7e7730` passed 64 native fixture tests; one Mac-only test was correctly skipped. The focused suite passed 32 tests, skipped one host-specific check, and failed its setup-cancellation observation. The CRLF regression passed. The workflow stopped at the failed fixture step and did not run the native runtime harness.

The cancellation test read Node child exit metadata immediately after the shutdown function observed that the OS process was gone. Windows can deliver the child exit event later. The test now registers the event before cancellation, checks that the PID is absent with `ESRCH`, and waits at most two seconds for the event before checking its exit metadata. The physical termination and artifact cleanup assertions remain. Product source did not change for this repair.


## Fourth Windows run: headless runtime qualification passed

[Run `37149760874`](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/37149760874) at `bceeb76e09fb9dce24b36d4fd0b690823d2db48e` completed successfully. Its bounded summary reports `passed:true`. The runner used Node `v20.20.2`; the actual portable companion used the verified VS Code runtime `v24.21.0`.

The pinned native Copilot CLI produced four spans in one trace with `invoke_agent`, `chat`, and `execute_tool`. Capture and actual fixed PowerShell tool execution both qualified. The known canary was observed before filtering and was absent from the retained receipt. The model was the local synthetic fixture; no paid model or Azure service was used.

The actual generated batch launcher exited with code 0. Quit removed the lease and ended the owned companion process. This proves the headless portable launcher, local Collector capture, native CLI fixture, and owned cleanup on the Windows runner. The summary keeps `desktopBrowserQualified:false`, `azureQualified:false`, and `normalUserProfileQualified:false`. Desktop UI, ordinary installation/discovery, normal-account use, Azure delivery, live model quality, and diagnostic value still need their separate checks.
