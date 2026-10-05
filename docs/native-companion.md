# Native CLI companion: macOS and Windows preview

The companion is a local macOS app or Windows portable folder with browser
controls. Users do not need to install Node, the AgentOps CLI, Azure CLI, or
Docker. This preview reuses the runtime in an **installed VS Code or VS Code
Insiders app**. It does not need a running VS Code window. A standalone signed
runtime remains a release requirement. Headless native Windows qualification
passed on Windows Server 2025; desktop installation, normal-user ACLs,
rendered GUI use and uninstall remain unverified.

```text
Double-click app -> Local browser controls -> Owned strict Collector :4318
Copilot CLI native OTel --------------------> Filtered local receipt -> Report
Administrator policy sample --------------> Separate reviewed device setup
```

## Build and use

A maintainer builds the reviewable app with `node scripts/package-native-companion.js --platform darwin --out <new-directory>`. Use `--platform win32` for the portable Windows folder. The output includes the app or portable folder, a package manifest with payload hashes, and a managed-policy sample. The app is unsigned. This is a local preview, not a notarized enterprise installer.

1. Open `AgentOps Native Companion.app` on Mac, or `Start AgentOps.cmd` on Windows. It opens local browser controls.
2. Select **Connect**. The app obtains the pinned official Collector release and verifies its published checksum, then starts strict capture at `http://127.0.0.1:4318`. An occupied port causes setup to fail. It does not replace another listener.
3. Select **Start Copilot in Terminal** to open a new session with capture settings. Only that session receives those settings. The launcher clears conflicting inherited OTel values in the new process, turns content capture off, and preserves normal account and permission behavior. Mac supports known installed native binaries, including the official npm platform package. Windows locates a native `copilot.exe` on PATH, including a normal Winget installation, or uses the installed native npm package. The headless Windows launcher and native receipt path are qualified; desktop install and normal-user use remain open. For other ordinary terminals, an administrator must review and merge the policy sample into effective managed Copilot policy. The sample locks content capture off. This app does not install policy, alter shell profiles, add a daemon, or change Copilot settings. Restart Copilot after policy activation. Higher-priority managed policy can supersede this file.
4. Start Copilot normally. Open the local report to inspect received spans and numeric token totals. A ready Collector does not prove actual CLI span receipt or complete coverage.
5. Select **Disconnect** to stop owned capture. Select **Quit companion** to stop capture and release ownership. The companion must remain open during capture. Browser tab closure alone does not stop it; use Quit.

The stable receiver address survives app restart. Automatic app startup is not installed. The existing VS Code extension may also use this port; only one owner can use it. Do not enable both recorders at the same time.

## Security and rollback

The control server binds an ephemeral port on `127.0.0.1`. It rejects foreign Host and Origin values. State changes need a random per-process token, exact JSON content, and a bounded request. The shared Collector stops at a monitored combined receipt/log threshold; a burst can exceed it. This is not a strict disk quota. The page uses a content security policy and does not accept remote scripts. Reports expose fixed labels and numbers only. Azure publishing is unavailable in this preview.

Storage defaults to `~/Library/Application Support/AgentOps Native Companion` on Mac and `%LOCALAPPDATA%\AgentOps Native Companion` on Windows. The app holds a private owner lease. The Collector worker owns child shutdown through IPC. Routine disconnect retains filtered receipts for review. No raw model content should reach those receipts; the existing strict Collector policy defines the filter contract. Content capture off does not alone remove every possible identifier.

Remove the app to uninstall this preview. Retained local receipts and the downloaded Collector remain in its private storage. Remove that exact folder only when its retained data is no longer required. If an administrator applied the sample, rollback must remove only the values still owned by this setup. Preserve later administrator changes. No generated script applies or removes OS policy.

## Proof and limits

Eleven focused tests pass: browser request guards and controls, managed policy content lock, duplicate ownership, shutdown during startup, client abort, idle keepalive, and unused browser preconnect sockets, closed package runtime resolution for Mac and Windows, scoped launch quoting/configuration, and Windows mode/PATH lookup regression checks. The tests use a fixture recorder and injected terminal launcher for browser controls; they do not replace real Collector or native CLI proof.

The app runtime reuse is a preview. Linux apps, signing/notarization,
unattended service installation, actual policy activation, crash restart, Azure
authentication, and project Python/JS library setup are not part of this
artifact. Parent integration exercised the historical packaged Mac browser
flow: Connect, native CLI receipt, a rendered report with four native spans and
24/10 observed input/output tokens, Disconnect with listener closure, and a
Quit acknowledgement. The CLI used an offline fixture provider; this proves
native CLI emission and local capture, not real model quality or Azure
delivery. A later process check found that v2 could keep its process and lease
after Quit when the browser kept an idle socket. v3 stops page polling, drains
idle HTTP connections, and closes unused browser preconnect sockets without
interrupting active responses or pending setup. Five server checks pass with
the actual installed VS Code Electron runtime, including idle-socket shutdown
within a 1 s test bound. The combined extension/companion/package runner and
repair checks pass locally as 65 plus 19 checks. The actual headless Windows
run `37149760874` passed with Copilot CLI 1.0.91, VS Code 1.140.0/Node 24.21.0,
Collector 0.151.0, four spans in one trace, canary removal, launcher exit 0,
owner-process cleanup and lease removal. It used a synthetic local provider;
no paid model ran. A test harness can pass `--storage <disposable-directory>`
to the launcher without changing the normal profile.

## Current reviewable artifacts

Latest unsigned preview outputs:

- Mac: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-companion-macos-v5/AgentOps Native Companion.app`
- Windows: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-companion-windows-v5/AgentOps Native Companion`
- Mac ZIP: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-companion-macos-v5/AgentOps-Native-Companion-mac-preview.zip`
- Windows ZIP: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-companion-windows-v5/AgentOps-Native-Companion-windows-preview.zip`
- VSIX: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-vsix-qualified-v4/agentops-local.agentops-native-0.1.0.vsix`
- Artifact manifest: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-package-manifest-v5/artifact-manifest.json`
- Windows qualification summary: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/native-build-20261003/windows-ci-final-summary/windows-qualification.json`

The v5 artifact manifest records 37/37/46 source matches and extraction
checks. The Windows qualification summary matched 69 qualification code,
asset and workflow paths with zero mismatches. The packages are unsigned;
cloud publishing is unavailable in the Companion and device policy is not
installed. The v5 ZIPs are package outputs;
the historical v3 Mac browser flow remains the rendered UI proof and does not
claim that the exact v5 ZIP was opened. The main checkout remained dirty and
uncommitted.
