# CLI-first native telemetry build status

Date: 2026-10-03

Status: macOS and headless Windows native qualification, plus one synthetic
Azure transport/readback proof, are complete for the current preview. Desktop
Windows installation, ordinary-shell activation, VS Code Chat emission and the
no-Azure-CLI Microsoft sign-in path remain open.

## Target architecture

```text
Copilot CLI (primary)       VS Code Chat (secondary)
        |                           |
        +-- native OTel ------------+
        +-- selected Python / JS / TS project launches
                                    |
                         one local strict Collector
                                    |
                 filtered receipt + bounded local queue
                                    |
                    optional manual Azure metadata upload
```

The companion and extension use a stable loopback endpoint. The companion
provides a CLI-first control page and starts Copilot in a new prepared
terminal. The extension provides the VS Code commands and selected script
wizard. The first Azure route reuses the existing DCR and metadata tables.
No second database, gateway, AKS cluster or hosted Grafana service is needed
for this preview.

## Implemented and verified

- [x] Installed Copilot CLI 1.0.91 emitted four native spans through the strict
  Collector: one agent, two chat and one tool span.
- [x] The CLI qualification used a local synthetic provider and a fixed
  `printf` tool. It made no paid model request and changed no normal profile.
- [x] The packaged macOS Companion used the actual Collector at port 4318,
  received the native spans and rendered a report with four spans, one
  session, 24 input tokens and 10 output tokens.
- [x] Companion Disconnect closed the listener. Companion Quit closed the
  server. The report screenshot is
  `<agent-workspace>/artifacts/native-build-20261003/companion-v3-report.png`.
- [x] Stable endpoint and durable opt-in survive routine host shutdown.
  Explicit Disconnect restores only still-owned settings.
- [x] CJS, ESM and Python HTTP library checks used real Collector receipts.
  The nine parent checks passed with the expected HTTP kind, run IDs and no
  privacy canary.
- [x] The local output monitor, retained storage limit, strict field filter,
  and Azure-request cancellation regressions passed.
- [x] The final CLI suite passed 1,033 tests, with one platform skip and zero
  failures. See `<agent-workspace>/artifacts/native-build-20261003/cli-suite-final.log`.
- [x] A portable macOS package and a Windows package were generated. Windows
  PE validation, PATH lookup and command safety are covered by structural
  tests.
- [x] The actual Windows qualification run
  [`37149760874`](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/37149760874)
  passed on Windows Server 2025. It used Copilot CLI 1.0.91, VS Code 1.140.0
  with Node 24.21.0, and Collector 0.151.0. The real pinned CLI produced four
  spans in one trace: `chat`, `execute_tool` and `invoke_agent` operations.
  Capture and tool qualification passed; the canary was present before and
  absent after filtering; the launcher exited 0; the owner process ended and
  the lease was removed. The provider was a synthetic local fixture, with no
  paid model request.
- [x] Final unsigned preview packages exist for macOS and Windows, with ZIPs,
  and the qualified v4 VSIX. The v5 artifact manifest reports 37/37/46 source
  matches and extraction checks. The Windows qualification summary matched 69
  qualification code, asset and workflow paths with zero mismatches. The main
  checkout stayed dirty and uncommitted; the qualification snapshot used a
  separate dedicated branch.
- [x] One prepared synthetic event was sent through the embedded Azure
  publisher: 473 request bytes, HTTP 204, one acknowledged row, and exact
  typed readback across all 63 maintained fields. The test used a cached Azure
  CLI token as an injected credential provider. It did not qualify the VS Code
  Microsoft authentication provider, least-privilege RBAC or a live Copilot
  upload.
- [x] The real extension-host script proof ran Node and Python HTTP fixtures,
  received three HTTP library spans, and exercised supervised cancellation.
  File, interpreter and consent dialogs were fixtures. A rendered wizard and
  report were not proved.

## Implemented but host or cloud unverified

- [ ] Windows desktop installation and uninstall, rendered desktop GUI,
  normal-user ACL behavior and administrator policy behavior. The passing run
  was headless Windows Server 2025 and does not qualify these surfaces.
- [x] The first Windows CI run (`37148214250`) failed portability checks before
  native fixture qualification. Repairs were reviewed and 65 plus 19 local
  checks passed. The later run `37149760874` passed its headless native gate.
- [ ] Native CLI capture from an ordinary shell after managed policy setup.
  The current extension and companion scope environment to a new terminal.
- [ ] Complete rendered VS Code Chat capture. Settings and Collector checks
  pass, but Chat can require a reload and a real Chat receipt is still needed.
- [ ] Azure sign-in through the VS Code Microsoft provider, tenant consent,
  least-privilege RBAC and a no-Azure-CLI user flow. The synthetic cached-token
  row proof does not close this gate.
- [ ] Real GitHub-hosted model quality and diagnostic benefit.

## Remaining build work

1. Run the Windows desktop gate with a normal user. Verify install, launch,
   rendered report, restart, Disconnect, Quit, uninstall, retained-file ACLs
   and administrator policy behavior. Keep this separate from the passing
   headless native gate.
2. ~~Extend the existing CLI-first install and status surface.~~ Implemented
   2026-10-04 in `extensions/agentops-native/src/capture-stages.js`. The
   companion `/status` JSON and page, and the extension status message, now
   show Collector, native receipt, script receipt, upload and cloud readback as
   separate states. Upload reads `unavailable` in the companion. Cloud readback
   reads `unverified` because nothing performs typed readback yet. The
   companion re-reads the receipt at most every 15 seconds (an OCR review
   finding: 5-second polls against a receipt up to 16 MiB). Tests: native
   69/69, supporting 34/34, packaging 2/2. Local only; not host-qualified.
3. Qualify ordinary-shell coverage through documented managed policy. Do not
   write root or administrator policy from the preview installer.
4. Qualify the VS Code Chat reload path in an isolated extension host. Keep the
   reload-required state until a native Chat receipt is read.
5. Complete the remaining Azure proof with the VS Code Microsoft provider,
   approved destination, least-privilege RBAC and typed readback. Keep
   publishing manual and off by default until this gate passes.
   Typed readback was built on 2026-10-04 in
   `extensions/agentops-native/src/azure-readback.js`, with the command
   "AgentOps: Verify Azure cloud readback". It has not been live-verified
   against a real native publish. A read-only smoke test against eval930 ran
   the fixed query. It returned `missing` for a placeholder ID, as expected.
6. Run a held-out diagnostic evaluation. Compare correct diagnosis, time to
   diagnosis, missing coverage, process overhead and accepted bytes against a
   baseline.

## Safety and scope rules

- [x] Keep content and identity capture off by default.
- [x] Keep the Collector on loopback and filter before durable storage or
  upload.
- [x] Use a bounded local receipt and report only approved numeric metadata.
- [x] Preserve later user and administrator changes during restore.
- [ ] Add automatic startup or device policy only as a separately reviewed,
  signed installer capability.
- [ ] Add broad Python or JS process injection only after a scoped privacy,
  loader and overhead evaluation. Current tracing is selected-project based.

The current Windows package is unsigned and has no automatic system startup.
The preview has no installed root policy, daemon, release signing or public
cloud deployment. The one-row synthetic Azure proof used the existing pilot
and a cached CLI token; it did not change resources or roles. Source changes
remain local and uncommitted. Computer-use retry again hit native pipe startup
failure, so the rendered script wizard and Azure sign-in UI remain unproved.

## Acceptance evidence

The detailed source and test evidence is in:

- [Final build verification](../research/2026-10-03-cli-first-build-verification.md)

- [Native CLI receipt proof](../research/2026-10-03-native-cli-proof.md)
- [Native build review](../research/2026-10-03-native-build-review.md)
- [CLI-first architecture](../research/2026-10-03-cli-first-native-architecture.md)
- [Auto-instrumentation and Azure audit](../research/2026-10-03-auto-instrument-azure-docs.md)
- [Native Azure proof preflight](../research/2026-10-03-native-azure-proof-preflight.md)
- [Selected script setup proof](../research/2026-10-03-script-setup-proof.md)

No passing Windows desktop GUI, normal-user ACL/install/uninstall, VS Code
Microsoft-provider sign-in, least-privilege RBAC check, paid model request or
public release is claimed by this document.
