# Native build review — 2026-10-03

Status: completed scoped review. No unresolved P1 or P2 findings in the reviewed snapshot.

## Coverage

Open Code Review delegation selected 27 entries from 164 workspace changes. All 27 were reviewed; zero selected entries were skipped; selected coverage is 100%. OCR excluded 137 entries because of the explicit task scope or its default document/test exclusions. Sixteen focused test files were reviewed separately. This is not a whole-repository review. Existing Graphify relationships were queried read-only, then verified against source. No product code was changed by this reviewer.

## Findings and repairs

1. P1, resolved: the strict Collector retained private instrumentation scope attributes, scope names and schema URLs. The reviewer reproduced all three leaks using the real cached Collector. The repair clears scope and schema metadata for traces, metrics and logs, clears traceState, drops spans with links, and sanitizes log eventName and severityText. The repaired real Collector regression passes. Dropped linked spans reduce coverage; do not claim complete linked-trace coverage.
2. P2, resolved: Disable Azure publishing did not stop an active queued drain. Current controls revoke the delivery generation, abort active fetches and check consent and capture ownership before and after token lookup. The multirow drain and pending-token regressions pass. A request already accepted by Azure cannot be recalled.
3. P2, resolved: local receipt and debug output could grow without a stop condition. The shared runtime now stops at a sampled 12 MiB combined output threshold and refuses new capture when retained receipt/log bytes reach 32 MiB. Tests cover receipt growth, log growth, retained quota and unsafe paths. A burst can exceed the sampled threshold. This is not a hard disk quota.
4. Resolved during review: companion close could race with an awaited connection. Current close drains HTTP requests, waits the pending action and stops the owned recorder. Tests include an aborted connection request.
5. Integration issue resolved: the new Azure delivery module used dynamic require, which the VSIX packager rejected. It now uses an explicit module map. The packager includes the closed Azure runtime and scoped script bootstrap assets.

## Verification

- Initial focused source/package/auth/settings/lifecycle/plan checks: 66 passed; initial companion checks: 3 passed.
- Final changed-source check: 75 passed, covering extension controls, companion control/launch, packagers and Collector lifecycle/output limits.
- After Azure revocation repair: 24 affected auth-control/delivery/uploader tests passed.
- Real pinned Collector metadata-canary regression: passed in approximately 1.90 seconds.
- Scoped whitespace check: passed.

Tests used local synthetic inputs, mocked authentication/network responses and harmless local subprocesses. The reviewer made no model request, Azure sign-in or cloud write. Temporary reviewer canary artifacts were removed after Collector shutdown. Other verification artifacts and active work were preserved.

## Qualification limits

The companion is an unsigned preview that reuses an installed VS Code runtime. Its native CLI launcher scopes configuration to a new terminal; it does not modify other terminal sessions or device policy. Windows output was structurally checked on macOS; actual Windows installation and execution remain unverified.

The VS Code extension has registered commands for native capture, selected script tracing and manual Azure publication. Source registration and manifest commands match. These unit checks do not prove the complete rendered VS Code flow or actual native Chat emission. Stable endpoint persistence fixes the identified lifecycle problem, but Chat export remains unverified.

Azure delivery currently projects native metadata events onto the existing event table. It omits arbitrary labels, hashes session IDs, retains measured durations and unique LLM span token counts, and excludes full waterfalls and generic library spans. It has a 10,000-ID admission limit per destination. Actual Microsoft sign-in, tenant consent, RBAC, ingestion and typed cloud readback remain unverified by this reviewer.

The strict Collector is an attribute and signal-field filter, not a general secret detector. Existing permitted resource and legacy attribute values remain possible content channels. The native Azure event projection removes arbitrary labels before cloud delivery. Generic Python/JS tracing is scoped and requires compatible project packages; internal functions and Node parent context need explicit instrumentation or propagation.

## Reviewed checklist

- `agentops-cli/src/lib/azure/logs-ingestion-upload.js` — reviewed; SHA256 `36034c2f24473ef7b835f0a42e826ef0508b4aed341120a289508ee1ccd31518`.
- `agentops-cli/src/lib/copilot/scoped-collector.js` — reviewed; SHA256 `cbc60aab78cb46e8f1bb1a31ad008749ad3f48caefefb21d59889b1afa9ac9b2`.
- `collector/otelcol.local.strict.yaml` — reviewed; SHA256 `9955e18ec706d8aeb7d8680f3a0f14199695bb6a035713563b1b6fac198c1c2b`.
- `companion/package.json` — reviewed; SHA256 `9780593e83147be656a037c970937e340781905af8bcf7be8c0f0766c0f2574d`.
- `companion/src/copilot-launch.js` — reviewed; SHA256 `644d265230dbb43d084f5b7bdfcb5bd570ac7e7af39b78c5ef82a05f1e065e46`.
- `companion/src/server.js` — reviewed; SHA256 `e416a4a1bdbc7f89d0b7663af7c5bd54d5fb846f685f4072de25cbf333cce128`.
- `extensions/agentops-native/package.json` — reviewed; SHA256 `cc83b78cbd795938420815aaa696de2353db686e7feb663275f8a462450190b7`.
- `extensions/agentops-native/src/azure-auth.js` — reviewed; SHA256 `56802d1d3e840e699931edbd1298670b00b388fc6fc8dde23f32b1d95e4c3a95`.
- `extensions/agentops-native/src/azure-controls.js` — reviewed; SHA256 `211c72a9dce355410e350f4741b63a5af432920411186d0f15eeade7e16824cf`.
- `extensions/agentops-native/src/azure-delivery.js` — reviewed; SHA256 `ea13062e4e842f883bf883c18e472976273c6bd8eefcf13e7a24bf333d3b15fe`.
- `extensions/agentops-native/src/extension.js` — reviewed; SHA256 `c9c4773986d19c4c611121ef62512ae7e254541e8e1c0aa074f4ed63d2cba625`.
- `extensions/agentops-native/src/library-report.js` — reviewed; SHA256 `d6b524b6ad776d527bea0ec0d5de1d69bf2873d798d29d809b99b0f74983de65`.
- `extensions/agentops-native/src/native-settings.js` — reviewed; SHA256 `5bc76ca27b1da6f899750f9e7c785cd928363d33f166b34237be761a81186b4c`.
- `extensions/agentops-native/src/recorder-worker.js` — reviewed; SHA256 `998cb93444bb4a02afe063ff2f4a9fdbf7e2bfcbf771c8f11adb2183016bf899`.
- `extensions/agentops-native/src/recorder.js` — reviewed; SHA256 `4499fe84f7c1b80714df570b83c7c7cb737e643a6947a9451c47bb3ea9babfb6`.
- `extensions/agentops-native/src/script-controls.js` — reviewed; SHA256 `2fc72d07b2398413eba765346eb37fd25c4e9534a726eb226fa2f64e508e4d31`.
- `instrumentation/auto/dependencies.json` — reviewed; SHA256 `e5487ee20741641b0bab49f9546606b6cc2e95a374bece06e1ba7bca43e59117`.
- `instrumentation/auto/node.cjs` — reviewed; SHA256 `da77479683c185c889455b1946e802453157b97bb5a6403da76063852ff07eda`.
- `instrumentation/auto/plan.cjs` — reviewed; SHA256 `d67a81b5a5ef5537a1d78ce9c158bfee07897c3116b3e10e89781e1e00e79b87`.
- `instrumentation/auto/python.py` — reviewed; SHA256 `64ef2d1981bb1275e3e8118487ae099c2886c2fe135acfe0ec5b10bc5375b12c`.
- `instrumentation/auto/test/collector.integration.cjs` — reviewed; SHA256 `b27bb7a42f30bfd2177fea00642984e33e3cf2d809860d650e43f91ad314cb92`.
- `instrumentation/auto/test/http.integration.cjs` — reviewed; SHA256 `a29f504eca5e34d986e930276229ec849cfc71adaa0408032720205b6073c097`.
- `instrumentation/auto/test/plan.test.cjs` — reviewed; SHA256 `ab7454c8a1de17ed44da97150b5ea8c8da99ac1687f1fadb1714c71a1871327c`.
- `scripts/package-native-companion.js` — reviewed; SHA256 `fb230aa6b326491a379c8b7e0ef4dd04d8414e04cb0b0fee32603e098e5cb767`.
- `scripts/package-native-extension.js` — reviewed; SHA256 `d8963e3674946469c697bad27dacabb1973c8c084a214a95d1522536473a0027`.
- `scripts/qualify-native-cli.js` — reviewed; SHA256 `c1a98bebd999a6c19ea1cc1b100e970dc62e1dab3f8dd3011651b3d6472381dc`.
- `scripts/qualify-safe-metrics.js` — reviewed; SHA256 `731b5b053746d0c32c056e61dcb75623c5eaf73aceaa8637ade843b4cca30a4c`.

## Manually reviewed focused tests

- `agentops-cli/test/logs-ingestion-upload.test.js` — reviewed.
- `agentops-cli/test/scoped-collector.test.js` — reviewed.
- `companion/test/copilot-launch.test.js` — reviewed.
- `companion/test/server.test.js` — reviewed.
- `extensions/agentops-native/test/azure-auth.test.js` — reviewed.
- `extensions/agentops-native/test/azure-controls.test.js` — reviewed.
- `extensions/agentops-native/test/azure-delivery.test.js` — reviewed.
- `extensions/agentops-native/test/extension.test.js` — reviewed.
- `extensions/agentops-native/test/library-report.test.js` — reviewed.
- `extensions/agentops-native/test/native-settings.test.js` — reviewed.
- `extensions/agentops-native/test/recorder.test.js` — reviewed.
- `extensions/agentops-native/test/script-controls.test.js` — reviewed.
- `scripts/test/package-native-companion.test.js` — reviewed.
- `scripts/test/package-native-extension.test.js` — reviewed.
- `scripts/test/qualify-native-cli.test.js` — reviewed.
- `scripts/test/qualify-safe-metrics.test.js` — reviewed.

## Final portability follow-up

A bounded follow-up reviewed the six files below. No unresolved P1 or P2 finding remains. The Mac structural packaging test explicitly selects `darwin`, so it does not inherit the Windows or Linux host target. The Windows executable guard uses PE magic and does not apply Unix mode or owner checks. Its PATH lookup uses the absolute system `where.exe`, accepts absolute native `copilot.exe` candidates and does not select `.cmd` launchers. This is not signature or Windows ACL verification.

The offline runner passes explicit test paths to Node and invokes no shell expansion. The CI change adds this runner to the existing offline matrix and does not change triggers or permissions. The final package retains the closed runtime and required source assets. The runner passed all 64 checks on macOS; scoped whitespace checks passed. Actual Windows execution remains unverified.

- `companion/src/copilot-launch.js` — reviewed; SHA256 `06d22d431e685eee471f2502aae441f70248f7fbfafd542dbbbe2feba2230aea`.
- `companion/test/copilot-launch.test.js` — reviewed; SHA256 `2426c1e1da92c9acb83b4321f456ce2be35995a13ccd5fc10036c464d6568979`.
- `scripts/run-native-tests.js` — reviewed; SHA256 `5cf1ab3b5d5bf52f98a75bc8bb12a17b11b07c9dfe744c2073da47b4e16b49e0`.
- `.github/workflows/ci.yml` — reviewed; SHA256 `844a76a1f9e9c95197b7a4b620ed3463af1585c6e44bb11bf9d057521f6c152c`.
- `scripts/package-native-companion.js` — reviewed; SHA256 `fb230aa6b326491a379c8b7e0ef4dd04d8414e04cb0b0fee32603e098e5cb767`.
- `scripts/test/package-native-companion.test.js` — reviewed; SHA256 `c079592227d2ec9564693431c14fe1548ae619f60def7d2fc283bed02f25a4f1`.

## GUI-found Quit repair follow-up

The bounded review read the two files below. No unresolved P1 or P2 finding remains. Shutdown closes the listener, drains idle HTTP connections and unused preconnect sockets, preserves active responses, then waits the pending capture action before stopping its recorder and releasing the lease. Idle sockets get an orderly end and a 200 ms fallback destroy. Request counters complete once, and the fallback does not destroy an active response. The pending and aborted Connect regressions remain present.

All five focused tests passed with normal Node and the actual installed VS Code Insiders Electron runtime in Node mode. The keepalive/preconnect shutdown test completed in approximately 205–207 ms. The first attempted stable VS Code runtime path was absent; the verified Insiders executable was then used. These are process/runtime tests. The parent owns the real rendered browser Quit readback.

- `companion/src/server.js` — reviewed; SHA256 `3d0b5aa2a4fb9c13f636f72f50eefec8814a571dba2d5bad5dffaca5ca2407a9`.
- `companion/test/server.test.js` — reviewed; SHA256 `30d383573197834f04104b1d39162c60232f99ab7aa1512c69fa75b5dab009ba`.
