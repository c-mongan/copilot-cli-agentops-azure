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

The parent owns review, snapshot copying, commits, any public push, dispatch, and readback. This local preparation did not perform those actions. Local checks pass on Mac; the first actual Windows run is the next gate.
